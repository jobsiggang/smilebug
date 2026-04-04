import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import School from '@/lib/models/School';
import Meal from '@/lib/models/Meal';

export const dynamic = 'force-dynamic';

export async function GET() {
  await connectDB();

  // KST 기준 오늘 날짜
  const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const todayYMD = kstNow.toISOString().split('T')[0].replace(/-/g, '');
  // const todayYMD = '20260406'; // 날짜 고정 테스트용

  // 학교 목록 + 오늘 급식을 병렬로 조회
  const [schools, meals] = await Promise.all([
    School.find({}, '-__v -_id').lean(),
    Meal.find({ date: todayYMD }, 'schoolCode menu -_id').lean(),
  ]);

  // schoolCode → menu 맵
  const mealMap = Object.fromEntries(meals.map((m) => [m.schoolCode, m.menu]));

  const result = schools.map((s) => ({
    ...s,
    meal: mealMap[s.schoolCode] ?? '급식 정보 없음',
  }));

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
