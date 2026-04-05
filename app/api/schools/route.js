import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import School from '@/lib/models/School';
import Meal from '@/lib/models/Meal';
import WeatherGrid from '@/lib/models/WeatherGrid';
import WeatherCache from '@/lib/models/WeatherCache';
import WeatherForecast from '@/lib/models/WeatherForecast';

export const dynamic = 'force-dynamic';

// 가장 가까운 격자 찾기 (위경도 유클리드 거리)
function findNearestGrid(lat, lng, grids) {
  if (!grids.length) return null;
  let best = null;
  let bestDist = Infinity;
  for (const g of grids) {
    const d = (g.lat - lat) ** 2 + (g.lng - lng) ** 2;
    if (d < bestDist) { bestDist = d; best = g; }
  }
  return best;
}

export async function GET() {
  await connectDB();

  // KST 기준 오늘 날짜
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayYMD = kstNow.toISOString().split('T')[0].replace(/-/g, '');

  // 병렬 조회: 학교, 급식, 기상격자, 날씨캐시, 예보캐시
  const [schools, meals, grids, weatherCaches, forecastCaches] = await Promise.all([
    School.find({}, '-__v -_id').lean(),
    Meal.find({ date: todayYMD }, 'schoolCode menu -_id').lean(),
    WeatherGrid.find({}, 'nx ny lat lng -_id').lean(),
    WeatherCache.find({}, 'nx ny T1H RN1 PTY REH WSD -_id').lean(),
    WeatherForecast.find({}, 'nx ny items -_id').lean(),
  ]);

  // schoolCode → menu 맵
  const mealMap = Object.fromEntries(meals.map((m) => [m.schoolCode, m.menu]));

  // "nx,ny" → 날씨 맵
  const weatherMap = Object.fromEntries(
    weatherCaches.map((w) => [`${w.nx},${w.ny}`, w])
  );

  // "nx,ny" → 예보 items 맵
  const forecastMap = Object.fromEntries(
    forecastCaches.map((f) => [`${f.nx},${f.ny}`, f.items])
  );

  const result = schools.map((s) => {
    const row = { ...s, meal: mealMap[s.schoolCode] ?? '급식 정보 없음' };

    // 날씨 데이터 있을 때만 추가
    if (grids.length && s.lat && s.lng) {
      const nearest = findNearestGrid(Number(s.lat), Number(s.lng), grids);
      if (nearest) {
        const key = `${nearest.nx},${nearest.ny}`;
        const w = weatherMap[key];
        if (w) {
          row.weather = {
            T1H: w.T1H,  // 기온(°C)
            RN1: w.RN1,  // 강수량(mm)
            PTY: w.PTY,  // 강수형태
            REH: w.REH,  // 습도(%)
            WSD: w.WSD,  // 풍속(m/s)
          };
        }
        const fc = forecastMap[key];
        if (fc?.length) row.forecast = fc; // 6시간 예보 items
      }
    }

    return row;
  });

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
