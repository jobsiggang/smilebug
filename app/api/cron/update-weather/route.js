import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import WeatherGrid from '@/lib/models/WeatherGrid';
import WeatherCache from '@/lib/models/WeatherCache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Vercel Cron: 매 정시(KST) 실행
 * vercel.json schedule: "5 * * * *"  (매 시각 5분에 실행 → 정시 발표 후 5분 여유)
 *
 * 전략: DB에 저장된 고유 (nx, ny) 격자 목록만 조회 → 중복 없이 API 호출
 * 학교 수(~2352) >> 고유 격자 수(~수백) 이므로 트래픽 대폭 절약
 */
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectDB();

  // KST 현재 시각
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  // 초단기실황: 매 정시 발표, 발표 후 10분 이내면 이전 시간 자료 사용
  const kstMinute = kstNow.getUTCMinutes();
  const kstHour   = kstMinute < 10
    ? (kstNow.getUTCHours() + 23) % 24   // 정시 직후 10분 이내 → 이전 시간
    : kstNow.getUTCHours();
  // 날짜도 시간 후퇴에 맞춰 조정
  const kstDate = kstMinute < 10 && kstNow.getUTCHours() === 0
    ? new Date(kstNow.getTime() - 86_400_000)  // 자정~10분 사이 → 전날
    : kstNow;
  const baseDate = kstDate.toISOString().split('T')[0].replace(/-/g, '');
  const baseTime = `${String(kstHour).padStart(2, '0')}00`;

  // DB에 저장된 고유 격자 목록 조회
  const grids = await WeatherGrid.find({}, 'nx ny').lean();
  // 중복 제거
  const uniqueGrids = Object.values(
    Object.fromEntries(grids.map((g) => [`${g.nx}_${g.ny}`, g]))
  );

  let successCount = 0;
  let failCount    = 0;
  const bulkOps    = [];

  // 10개씩 병렬 호출
  const CHUNK = 10;
  for (let i = 0; i < uniqueGrids.length; i += CHUNK) {
    await Promise.all(
      uniqueGrids.slice(i, i + CHUNK).map(async ({ nx, ny }) => {
        const url =
          `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst` +
          `?ServiceKey=${encodeURIComponent(process.env.WEATHER_API_KEY)}` +
          `&pageNo=1&numOfRows=10&dataType=JSON` +
          `&base_date=${baseDate}&base_time=${baseTime}` +
          `&nx=${nx}&ny=${ny}`;

        try {
          const res  = await fetch(url, { signal: AbortSignal.timeout(8_000) });
          const text = await res.text();
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            // XML 에러 응답 (인증 실패, 서비스 사용 불가 등)
            const code = text.match(/returnReasonCode>(.*?)</)?.[1] ?? 'XML_RESPONSE';
            console.error(`nx=${nx},ny=${ny} XML 응답 [${code}]:`, text.slice(0, 200));
            failCount++;
            return;
          }
          const resultCode = json.response?.header?.resultCode;
          if (resultCode !== '00') {
            console.error(`nx=${nx},ny=${ny} API 오류: ${resultCode} ${json.response?.header?.resultMsg}`);
            failCount++;
            return;
          }
          const items = json.response?.body?.items?.item ?? [];
          if (!items.length) return;

          // category 값을 키-값 맵으로 변환
          const obs = Object.fromEntries(
            items.map((it) => [it.category, parseFloat(it.obsrValue)])
          );

          bulkOps.push({
            updateOne: {
              filter: { nx, ny },
              update: {
                $set: {
                  baseDate, baseTime,
                  T1H: obs.T1H ?? null,
                  RN1: obs.RN1 ?? null,
                  SKY: obs.SKY ?? null,
                  PTY: obs.PTY ?? null,
                  REH: obs.REH ?? null,
                  WSD: obs.WSD ?? null,
                  updatedAt: new Date(),
                },
              },
              upsert: true,
            },
          });
          successCount++;
        } catch (err) {
          console.error(`nx=${nx},ny=${ny} 실패:`, err.message);
          failCount++;
        }
      })
    );
  }

  if (bulkOps.length > 0) {
    await WeatherCache.bulkWrite(bulkOps, { ordered: false });
  }

  return NextResponse.json({
    success: true,
    baseDate, baseTime,
    totalGrids: uniqueGrids.length,
    successCount, failCount,
  });
}
