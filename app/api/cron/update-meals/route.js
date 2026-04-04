import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import School from '@/lib/models/School';
import Meal from '@/lib/models/Meal';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel 무료플랜 최대 60초

/**
 * Vercel Cron Job: 매일 02:00 KST (= 17:00 UTC)
 * vercel.json의 schedule: "0 17 * * *"
 *
 * NEIS API를 시도교육청 단위로 호출하여 요청 수를 최소화합니다.
 * (~2200개 학교 개별 호출 대신 ~17개 시도 단위 호출)
 */
export async function GET(request) {
  // Vercel Cron 인증 — Vercel이 자동으로 Authorization 헤더를 붙여 줍니다
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectDB();

  // KST 기준 오늘 날짜 (YYYYMMDD)
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayYMD = kstNow.toISOString().split('T')[0].replace(/-/g, '');

  // DB에서 고등학교 목록 조회 (atptCode + schoolCode만 필요)
  const schools = await School.find({}, 'name atptCode schoolCode').lean();

  // atptCode 기준으로 그룹핑 → 시도 단위로 NEIS API 1회 호출
  const byAtpt = schools.reduce((acc, s) => {
    if (!acc[s.atptCode]) acc[s.atptCode] = [];
    acc[s.atptCode].push(s);
    return acc;
  }, {});

  let successCount = 0;
  let failCount = 0;

  for (const [atptCode, group] of Object.entries(byAtpt)) {
    try {
      // 한 시도의 당일 급식 전체를 한 번에 조회 (중식 MMEALSCCODE=2)
      const url =
        `https://open.neis.go.kr/hub/mealServiceDietInfo` +
        `?KEY=${process.env.NEIS_API_KEY}` +
        `&Type=json` +
        `&ATPT_OFCDC_SC_CODE=${atptCode}` +
        `&MLSV_FROM_YMD=${todayYMD}` +
        `&MLSV_TO_YMD=${todayYMD}` +
        `&MMEAL_SC_CODE=2` + // 중식
        `&pSize=1000`;

      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const data = await res.json();

      // 해당 시도에 급식 데이터가 없으면 건너뜀
      if (data.RESULT?.CODE === 'INFO-200') continue;

      const rows = data.mealServiceDietInfo?.[1]?.row ?? [];

      // 해당 시도 학교를 schoolCode로 빠르게 참조
      const schoolMap = Object.fromEntries(group.map((s) => [s.schoolCode, s]));

      const bulkOps = rows
        .map((row) => {
          const schoolCode = String(row.SD_SCHUL_CODE);
          if (!schoolMap[schoolCode]) return null; // 고등학교가 아닌 경우 제외

          const menu = row.DDISH_NM
            .replace(/<[^>]*>/g, '')       // HTML 태그 제거
            .replace(/\s*\([^)]*\)/g, '')  // 알레르기 번호 (1.2.3) 제거
            .replace(/\s+/g, ' ')
            .trim();

          return {
            updateOne: {
              filter: { schoolCode, date: todayYMD },
              update: { $set: { atptCode, menu, updatedAt: new Date() } },
              upsert: true,
            },
          };
        })
        .filter(Boolean);

      if (bulkOps.length > 0) {
        await Meal.bulkWrite(bulkOps, { ordered: false });
        successCount += bulkOps.length;
      }
    } catch (err) {
      console.error(`atptCode=${atptCode} 업데이트 실패:`, err.message);
      failCount++;
    }
  }

  console.log(`[cron] ${todayYMD} 급식 업데이트 완료: 성공=${successCount}, 실패=${failCount}`);
  return NextResponse.json({ success: true, date: todayYMD, successCount, failCount });
}
