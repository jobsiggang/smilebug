import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import School from '@/lib/models/School';
import WeatherGrid from '@/lib/models/WeatherGrid';
import WeatherForecast from '@/lib/models/WeatherForecast';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Vercel Cron: 6시간마다 실행
 * vercel.json schedule: "5 0-23/6 * * *"  (UTC 0:05, 6:05, 12:05, 18:05)
 *
 * 초단기예보(getUltraSrtFcst): 30분 발표 / 6시간 예보
 * 전략: 학교와 인접한 고유 (nx, ny) 격자만 조회 → 불필요한 API 호출 절감
 */

function findNearestGrid(lat, lng, grids) {
  if (!grids.length) return null;
  let best = null, bestDist = Infinity;
  for (const g of grids) {
    const d = (g.lat - lat) ** 2 + (g.lng - lng) ** 2;
    if (d < bestDist) { bestDist = d; best = g; }
  }
  return best;
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectDB();

  // KST 현재 시각
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const kstH   = kstNow.getUTCHours();
  const kstM   = kstNow.getUTCMinutes();

  // 초단기예보: 30분 단위 발표, 발표 후 ~45분 후 확정
  // 45분 버퍼로 이전 30분 단위 base_time 계산
  const safeMs  = kstNow.getTime() - 45 * 60 * 1000;
  const safeNow = new Date(safeMs);
  const safeH  = safeNow.getUTCHours();
  const safeM  = safeNow.getUTCMinutes();
  const baseMin30 = Math.floor(safeM / 30) * 30; // 0 or 30

  const baseDate = safeNow.toISOString().split('T')[0].replace(/-/g, '');
  const baseTime = `${String(safeH).padStart(2, '0')}${String(baseMin30).padStart(2, '0')}`;

  // 학교와 인접한 고유 격자만 처리
  const [schools, grids] = await Promise.all([
    School.find({}, 'lat lng').lean(),
    WeatherGrid.find({}, 'nx ny lat lng').lean(),
  ]);

  const neededSet = new Map();
  for (const s of schools) {
    if (!s.lat || !s.lng) continue;
    const g = findNearestGrid(Number(s.lat), Number(s.lng), grids);
    if (g) neededSet.set(`${g.nx}_${g.ny}`, { nx: g.nx, ny: g.ny });
  }
  const uniqueGrids = [...neededSet.values()];

  const WANTED = new Set(['T1H', 'SKY', 'PTY', 'RN1', 'REH', 'WSD']);
  let successCount = 0;
  let failCount    = 0;
  const bulkOps    = [];

  const CHUNK = 20;
  for (let i = 0; i < uniqueGrids.length; i += CHUNK) {
    await Promise.all(
      uniqueGrids.slice(i, i + CHUNK).map(async ({ nx, ny }) => {
        const url =
          `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst` +
          `?ServiceKey=${encodeURIComponent(process.env.WEATHER_API_KEY)}` +
          `&pageNo=1&numOfRows=60&dataType=JSON` +
          `&base_date=${baseDate}&base_time=${baseTime}` +
          `&nx=${nx}&ny=${ny}`;

        try {
          const res  = await fetch(url, { signal: AbortSignal.timeout(8_000) });
          const text = await res.text();

          let json;
          try {
            json = JSON.parse(text);
          } catch {
            const code = text.match(/returnReasonCode>(.*?)</)?.[1] ?? 'XML';
            console.error(`예보 nx=${nx},ny=${ny} XML [${code}]:`, text.slice(0, 150));
            failCount++;
            return;
          }

          const resultCode = json.response?.header?.resultCode;
          if (resultCode !== '00') {
            console.error(`예보 nx=${nx},ny=${ny} 오류: ${resultCode}`);
            failCount++;
            return;
          }

          const items = json.response?.body?.items?.item ?? [];
          if (!items.length) return;

          // fcstDate+fcstTime 기준으로 그루핑
          const fcstMap = {};
          for (const item of items) {
            if (!WANTED.has(item.category)) continue;
            const key = `${item.fcstDate}_${item.fcstTime}`;
            if (!fcstMap[key]) fcstMap[key] = { fcstDate: item.fcstDate, fcstTime: item.fcstTime };
            const val = parseFloat(item.fcstValue);
            fcstMap[key][item.category] = isNaN(val) ? null : val;
          }

          const forecastItems = Object.values(fcstMap)
            .sort((a, b) => `${a.fcstDate}${a.fcstTime}`.localeCompare(`${b.fcstDate}${b.fcstTime}`));

          bulkOps.push({
            updateOne: {
              filter: { nx, ny },
              update: {
                $set: { baseDate, baseTime, items: forecastItems, updatedAt: new Date() },
              },
              upsert: true,
            },
          });
          successCount++;
        } catch (err) {
          console.error(`예보 nx=${nx},ny=${ny} 실패:`, err.message);
          failCount++;
        }
      })
    );
  }

  let dbCount = 0;
  if (bulkOps.length > 0) {
    try {
      await WeatherForecast.bulkWrite(bulkOps, { ordered: false });
      dbCount = await WeatherForecast.countDocuments();
    } catch (err) {
      console.error('WeatherForecast bulkWrite 오류:', err.message);
    }
  }

  return NextResponse.json({
    success: true,
    baseDate, baseTime,
    totalGrids: uniqueGrids.length,
    successCount, failCount,
    dbCount,
  });
}
