import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import School from '@/lib/models/School';
import Meal from '@/lib/models/Meal';
import WeatherGrid from '@/lib/models/WeatherGrid';

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

  // 병렬 조회: 학교, 급식, 기상격자
  const [schools, meals, grids] = await Promise.all([
    School.find({}, '-__v -_id').lean(),
    Meal.find({ date: todayYMD }, 'schoolCode menu -_id').lean(),
    WeatherGrid.find({}, 'nx ny lat lng -_id').lean(),
  ]);

  // schoolCode → menu 맵
  const mealMap = Object.fromEntries(meals.map((m) => [m.schoolCode, m.menu]));

  const result = schools.map((s) => {
    const row = { ...s, meal: mealMap[s.schoolCode] ?? '급식 정보 없음' };

    // 가장 가까운 격자의 nx, ny를 추가 (클라이언트가 날씨 API 호출 시 사용)
    if (grids.length && s.lat && s.lng) {
      const nearest = findNearestGrid(Number(s.lat), Number(s.lng), grids);
      if (nearest) {
        row.nx = nearest.nx;
        row.ny = nearest.ny;
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
