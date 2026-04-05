import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';
import WeatherCache from '@/lib/models/WeatherCache';
import WeatherForecast from '@/lib/models/WeatherForecast';

export const dynamic = 'force-dynamic';

const WEATHER_API_KEY = process.env.WEATHER_API_KEY;

// KST 현재 시각 객체 반환
function getKstNow() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

// 초단기실황용 base_date, base_time (정시 발표, 10분 버퍼)
function getNcstBaseTime() {
  const kst = getKstNow();
  const kstMinute = kst.getUTCMinutes();
  const useHour = kstMinute < 10
    ? (kst.getUTCHours() + 23) % 24
    : kst.getUTCHours();
  const kstDate = (kstMinute < 10 && kst.getUTCHours() === 0)
    ? new Date(kst.getTime() - 86_400_000)
    : kst;
  return {
    baseDate: kstDate.toISOString().split('T')[0].replace(/-/g, ''),
    baseTime: `${String(useHour).padStart(2, '0')}00`,
  };
}

// 초단기예보용 base_date, base_time (30분 단위 발표, 45분 버퍼)
function getFcstBaseTime() {
  const kst = getKstNow();
  const safeMs = kst.getTime() - 45 * 60 * 1000;
  const safe = new Date(safeMs);
  const baseMin30 = Math.floor(safe.getUTCMinutes() / 30) * 30;
  return {
    baseDate: safe.toISOString().split('T')[0].replace(/-/g, ''),
    baseTime: `${String(safe.getUTCHours()).padStart(2, '0')}${String(baseMin30).padStart(2, '0')}`,
  };
}

// parseFloat이 NaN을 반환할 경우 null 처리 (예: '-')
function safeFloat(v) {
  const f = parseFloat(v);
  return isNaN(f) ? null : f;
}

// 초단기실황 KMA API 호출
async function fetchNcst(nx, ny) {
  const { baseDate, baseTime } = getNcstBaseTime();
  const url =
    `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst` +
    `?ServiceKey=${encodeURIComponent(WEATHER_API_KEY)}` +
    `&pageNo=1&numOfRows=10&dataType=JSON` +
    `&base_date=${baseDate}&base_time=${baseTime}` +
    `&nx=${nx}&ny=${ny}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`KMA 실황 XML 응답: ${text.slice(0, 200)}`);
  }
  const resultCode = json.response?.header?.resultCode;
  if (resultCode !== '00') {
    throw new Error(`KMA 실황 오류: ${resultCode} ${json.response?.header?.resultMsg}`);
  }
  const items = json.response?.body?.items?.item ?? [];
  const data = {};
  for (const item of items) {
    data[item.category] = safeFloat(item.obsrValue);
  }
  return {
    T1H: data.T1H ?? null,
    RN1: data.RN1 ?? null,
    PTY: data.PTY ?? null,
    REH: data.REH ?? null,
    WSD: data.WSD ?? null,
    baseDate,
    baseTime,
  };
}

// 초단기예보 KMA API 호출
async function fetchFcst(nx, ny) {
  const { baseDate, baseTime } = getFcstBaseTime();
  const url =
    `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst` +
    `?ServiceKey=${encodeURIComponent(WEATHER_API_KEY)}` +
    `&pageNo=1&numOfRows=60&dataType=JSON` +
    `&base_date=${baseDate}&base_time=${baseTime}` +
    `&nx=${nx}&ny=${ny}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`KMA 예보 XML 응답: ${text.slice(0, 200)}`);
  }
  const resultCode = json.response?.header?.resultCode;
  if (resultCode !== '00') {
    throw new Error(`KMA 예보 오류: ${resultCode} ${json.response?.header?.resultMsg}`);
  }

  const WANTED = new Set(['T1H', 'SKY', 'PTY', 'RN1', 'REH', 'WSD']);
  const raw = json.response?.body?.items?.item ?? [];
  const byTime = {};
  for (const item of raw) {
    if (!WANTED.has(item.category)) continue;
    const key = `${item.fcstDate}_${item.fcstTime}`;
    if (!byTime[key]) byTime[key] = { fcstDate: item.fcstDate, fcstTime: item.fcstTime };
    byTime[key][item.category] = safeFloat(item.fcstValue);
  }
  const items = Object.values(byTime).sort((a, b) =>
    `${a.fcstDate}${a.fcstTime}`.localeCompare(`${b.fcstDate}${b.fcstTime}`)
  );
  return { baseDate, baseTime, items };
}

// GET /api/weather?nx=60&ny=127
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const nx = parseInt(searchParams.get('nx'), 10);
  const ny = parseInt(searchParams.get('ny'), 10);

  if (!nx || !ny) {
    return NextResponse.json({ error: 'nx, ny 파라미터 필요' }, { status: 400 });
  }

  await connectDB();

  const now = Date.now();
  const NCST_TTL_MS   = 55 * 60 * 1000;  // 55분
  const FCST_TTL_MS   = 6 * 60 * 60 * 1000; // 6시간

  // 실황 캐시 확인 + 필요 시 갱신
  let currentData = null;
  try {
    let cached = await WeatherCache.findOne({ nx, ny }).lean();
    const needsRefresh = !cached || (now - new Date(cached.updatedAt).getTime() > NCST_TTL_MS);

    if (needsRefresh) {
      const fresh = await fetchNcst(nx, ny);
      cached = await WeatherCache.findOneAndUpdate(
        { nx, ny },
        { ...fresh, updatedAt: new Date() },
        { upsert: true, new: true }
      ).lean();
    }

    currentData = {
      T1H: cached.T1H,
      RN1: cached.RN1,
      PTY: cached.PTY,
      REH: cached.REH,
      WSD: cached.WSD,
    };
  } catch (err) {
    console.error(`날씨 실황 오류 nx=${nx},ny=${ny}:`, err.message);
  }

  // 예보 캐시 확인 + 필요 시 갱신
  let forecastData = null;
  try {
    let cached = await WeatherForecast.findOne({ nx, ny }).lean();
    const needsRefresh = !cached || (now - new Date(cached.updatedAt).getTime() > FCST_TTL_MS);

    if (needsRefresh) {
      const fresh = await fetchFcst(nx, ny);
      cached = await WeatherForecast.findOneAndUpdate(
        { nx, ny },
        { ...fresh, updatedAt: new Date() },
        { upsert: true, new: true }
      ).lean();
    }

    forecastData = cached.items ?? [];
  } catch (err) {
    console.error(`날씨 예보 오류 nx=${nx},ny=${ny}:`, err.message);
  }

  return NextResponse.json({
    current:  currentData,
    forecast: forecastData,
  });
}
