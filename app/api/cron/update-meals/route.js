import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import School from '@/lib/models/School';
import Meal from '@/lib/models/Meal';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel 무료플랜 최대 60초

// 병렬 처리 헬퍼: 배열을 size 단위 청크로 나눠 순차 실행
async function runInChunks(items, size, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    results.push(...(await Promise.all(chunk.map(fn))));
  }
  return results;
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await connectDB();

  // KST 기준 오늘 날짜 (YYYYMMDD) — 테스트 시 아래 주석 해제
  // const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
  // const todayYMD = kstNow.toISOString().split('T')[0].replace(/-/g, '');
  const todayYMD = '20260406'; // 날짜 고정 테스트용

  const schools = await School.find({}, 'name atptCode schoolCode').lean();

  let successCount = 0;
  let failCount = 0;
  const bulkOps = [];

  // 학교별로 NEIS API 호출 (20개씩 병렬)
  await runInChunks(schools, 20, async (school) => {
    const url =
      `https://open.neis.go.kr/hub/mealServiceDietInfo` +
      `?KEY=${process.env.NEIS_API_KEY}` +
      `&Type=json` +
      `&ATPT_OFCDC_SC_CODE=${school.atptCode}` +
      `&SD_SCHUL_CODE=${school.schoolCode}` +
      `&MLSV_FROM_YMD=${todayYMD}` +
      `&MLSV_TO_YMD=${todayYMD}` +
      `&MMEAL_SC_CODE=2`;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const data = await res.json();

      // INFO-200: 해당 날짜 급식 없음
      if (data.RESULT?.CODE === 'INFO-200') return;

      const rows = data.mealServiceDietInfo?.[1]?.row ?? [];
      if (rows.length === 0) return;

      const menu = rows[0].DDISH_NM
        .replace(/<br\s*\/?>/gi, '\n')   // <br/> → 줄바꿈
        .replace(/<[^>]*>/g, '')         // 나머지 HTML 태그 제거
        .replace(/\s*\([^)]*\)/g, '')    // 알레르기 번호 (1.2.3) 제거
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .join('\n');

      bulkOps.push({
        updateOne: {
          filter: { schoolCode: school.schoolCode, date: todayYMD },
          update: { $set: { atptCode: school.atptCode, menu, updatedAt: new Date() } },
          upsert: true,
        },
      });
      successCount++;
    } catch (err) {
      console.error(`${school.name} 실패:`, err.message);
      failCount++;
    }
  });

  if (bulkOps.length > 0) {
    await Meal.bulkWrite(bulkOps, { ordered: false });
  }

  console.log(`[cron] ${todayYMD} 급식 업데이트: 성공=${successCount}, 실패=${failCount}`);
  return NextResponse.json({ success: true, date: todayYMD, successCount, failCount });
}
