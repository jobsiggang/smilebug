'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// ─── 상수 ──────────────────────────────────────────────────────────────────
const REGIONS = [
  '전체', '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];

const TYPE_COLORS = {
  '일반고':   '#2563eb',
  '특목고':   '#ea580c',
  '특성화고': '#16a34a',
  '자율고':   '#7c3aed',
  '기타':     '#6b7280',
};

function getTypeColor(type) {
  for (const [key, color] of Object.entries(TYPE_COLORS)) {
    if (type?.includes(key)) return color;
  }
  return TYPE_COLORS['기타'];
}

function makeMarkerSVG(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">
    <path fill="${color}" stroke="white" stroke-width="1.5"
      d="M11 0C4.93 0 0 4.93 0 11c0 8.25 11 19 11 19S22 19.25 22 11C22 4.93 17.07 0 11 0z"/>
    <circle cx="11" cy="11" r="4.5" fill="white"/>
  </svg>`;
}

function makeMySchoolSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
    <path fill="#f59e0b" stroke="white" stroke-width="1.5"
      d="M14 0C6.27 0 0 6.27 0 14c0 9.9 14 22 14 22S28 23.9 28 14C28 6.27 21.73 0 14 0z"/>
    <text x="14" y="20" text-anchor="middle" font-size="14" fill="white" font-weight="bold">★</text>
  </svg>`;
}

function makeLocationSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
    <circle cx="10" cy="10" r="9" fill="#2563eb" fill-opacity="0.2"/>
    <circle cx="10" cy="10" r="5" fill="#2563eb" stroke="white" stroke-width="2"/>
  </svg>`;
}

// ─── 컴포넌트 ───────────────────────────────────────────────────────────────
export default function SchoolMapPage() {
  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const clustererRef    = useRef(null);
  const schoolsRef      = useRef([]);

  const [mapsReady, setMapsReady]         = useState(false);
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [searchQuery, setSearchQuery]     = useState('');
  const [regionFilter, setRegionFilter]   = useState('전체');
  const [shownCount, setShownCount]       = useState(0);
  const [totalCount, setTotalCount]       = useState(0);
  const [isLoading, setIsLoading]         = useState(true);
  const [loadError, setLoadError]         = useState(null);
  const [weatherData, setWeatherData]     = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [mySchoolCode, setMySchoolCode]   = useState(null);
  const mySchoolCodeRef   = useRef(null);
  const locationMarkerRef = useRef(null);
  const [isMobile, setIsMobile]           = useState(false);

  // ── 0) 모바일 감지 ───────────────────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    setIsMobile(mq.matches);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── 1) 카카오맵 SDK 로드 + 학교 데이터 fetch 병렬 처리 ──────────────────
  useEffect(() => {
    let mounted = true;

    // SDK는 layout.js에서 이미 로드됨 → kakao.maps.load만 호출
    const sdkPromise = new Promise((resolve, reject) => {
      const waitForKakao = (tries = 0) => {
        if (window.kakao?.maps) {
          window.kakao.maps.load(resolve);
        } else if (tries < 30) {
          setTimeout(() => waitForKakao(tries + 1), 100);
        } else {
          reject(new Error('카카오맵 SDK 로드 실패. API 키 또는 도메인 설정을 확인하세요.'));
        }
      };
      waitForKakao();
    });

    // 학교 데이터 fetch
    const dataPromise = fetch('/api/schools')
      .then((res) => {
        if (!res.ok) throw new Error('학교 데이터를 불러오지 못했습니다.');
        return res.json();
      });

    // 둘 다 완료되면 지도 초기화
    Promise.all([sdkPromise, dataPromise])
      .then(([, schools]) => {
        if (!mounted) return;
        schoolsRef.current = schools;
        setTotalCount(schools.length);
        // 우리 학교 localStorage에서 불러오기 (initMap 전에 ref 세팅)
        const savedCode = localStorage.getItem('mySchoolCode');
        if (savedCode) {
          mySchoolCodeRef.current = savedCode;
          setMySchoolCode(savedCode);
        }
        initMap(schools);
        setMapsReady(true);
        setIsLoading(false);
      })
      .catch((err) => {
        if (mounted) { setLoadError(err.message); setIsLoading(false); }
      });

    return () => { mounted = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2) 지도 초기화 ───────────────────────────────────────────────────────
  function initMap(schools) {
    const map = new kakao.maps.Map(mapContainerRef.current, {
      center: new kakao.maps.LatLng(36.5, 127.8),
      level: 12,
    });
    mapRef.current = map;

    map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);

    const clusterer = new kakao.maps.MarkerClusterer({
      map,
      averageCenter: true,
      minLevel: 8,
      calculator: [10, 50, 200],
      styles: [
        { width: '40px', height: '40px', background: 'rgba(37,99,235,0.85)', borderRadius: '50%', color: '#fff', textAlign: 'center', lineHeight: '40px', fontSize: '13px', fontWeight: '700' },
        { width: '50px', height: '50px', background: 'rgba(37,99,235,0.9)',  borderRadius: '50%', color: '#fff', textAlign: 'center', lineHeight: '50px', fontSize: '13px', fontWeight: '700' },
        { width: '60px', height: '60px', background: 'rgba(37,99,235,0.95)', borderRadius: '50%', color: '#fff', textAlign: 'center', lineHeight: '60px', fontSize: '14px', fontWeight: '700' },
      ],
    });
    clustererRef.current = clusterer;

    const count = renderMarkers(schools);
    setShownCount(count);

    // 현재 위치 표시 (비동기)
    initGeolocation(map);

    // 우리 학교 자동 오픈
    if (mySchoolCodeRef.current) {
      const myS = schools.find((s) => String(s.schoolCode) === String(mySchoolCodeRef.current));
      if (myS && !isNaN(myS.lat)) {
        map.setCenter(new kakao.maps.LatLng(Number(myS.lat), Number(myS.lng)));
        map.setLevel(5);
        setSelectedSchool(myS);
      }
    }
  }

  // ── 현재 위치 마커 ─────────────────────────────────────────────────────
  function initGeolocation(map) {
    if (!navigator?.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude: lat, longitude: lng } }) => {
        // 우리 학교 미등록 시에만 현재 위치로 이동
        if (!mySchoolCodeRef.current) {
          map.setCenter(new kakao.maps.LatLng(lat, lng));
          map.setLevel(7);
        }
        // 현재 위치 마커
        if (locationMarkerRef.current) locationMarkerRef.current.setMap(null);
        const locMarker = new kakao.maps.Marker({
          position: new kakao.maps.LatLng(lat, lng),
          image: new kakao.maps.MarkerImage(
            'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(makeLocationSVG()),
            new kakao.maps.Size(20, 20),
            { offset: new kakao.maps.Point(10, 10) },
          ),
          title: '현재 위치',
          zIndex: 5,
        });
        locMarker.setMap(map);
        locationMarkerRef.current = locMarker;
      },
      () => {}, // 거부/오류 시 무시
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  // ── 3) 마커 렌더링 (필터 적용) ───────────────────────────────────────────
  function renderMarkers(schools) {
    if (!clustererRef.current) return 0;
    clustererRef.current.clear();

    const markers = schools
      .filter((s) => !isNaN(s.lat) && !isNaN(s.lng))
      .map((school) => {
        const isMy = mySchoolCodeRef.current && String(school.schoolCode) === String(mySchoolCodeRef.current);
        const img = new kakao.maps.MarkerImage(
          'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
            isMy ? makeMySchoolSVG() : makeMarkerSVG(getTypeColor(school.type))
          ),
          isMy ? new kakao.maps.Size(28, 36) : new kakao.maps.Size(22, 30),
          { offset: isMy ? new kakao.maps.Point(14, 36) : new kakao.maps.Point(11, 30) },
        );
        const marker = new kakao.maps.Marker({
          position: new kakao.maps.LatLng(Number(school.lat), Number(school.lng)),
          image: img,
          title: school.name,
        });
        kakao.maps.event.addListener(marker, 'click', () => setSelectedSchool(school));
        return marker;
      });

    clustererRef.current.addMarkers(markers);
    return markers.length;
  }

  // ── 4) 학교 선택 시 날씨 on-demand fetch ───────────────────────────────
  useEffect(() => {
    if (!selectedSchool?.nx || !selectedSchool?.ny) {
      setWeatherData(null);
      return;
    }
    let cancelled = false;
    setWeatherData(null);
    setWeatherLoading(true);
    fetch(`/api/weather?nx=${selectedSchool.nx}&ny=${selectedSchool.ny}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (!cancelled) { setWeatherData(data); setWeatherLoading(false); } })
      .catch(() => { if (!cancelled) setWeatherLoading(false); });
    return () => { cancelled = true; };
  }, [selectedSchool]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 우리 학교 등록/해제 ────────────────────────────────────────────────
  function handleMySchool(school) {
    const newCode = String(mySchoolCode) === String(school.schoolCode) ? null : String(school.schoolCode);
    mySchoolCodeRef.current = newCode;
    setMySchoolCode(newCode);
    if (newCode) localStorage.setItem('mySchoolCode', newCode);
    else localStorage.removeItem('mySchoolCode');
  }

  // ── 5) 검색·필터 변경 시 마커 재렌더링 ──────────────────────────────────
  useEffect(() => {
    if (!mapsReady) return;

    const q = searchQuery.trim().toLowerCase();
    const filtered = schoolsRef.current.filter((s) => {
      const matchRegion = regionFilter === '전체' || s.region?.includes(regionFilter);
      const matchSearch = !q || s.name?.toLowerCase().includes(q);
      return matchRegion && matchSearch;
    });

    const count = renderMarkers(filtered);
    setShownCount(count);

    // 검색 결과가 1개면 지도 중심 이동
    if (filtered.length === 1 && !isNaN(filtered[0].lat)) {
      mapRef.current.setCenter(
        new kakao.maps.LatLng(Number(filtered[0].lat), Number(filtered[0].lng)),
      );
      mapRef.current.setLevel(5);
      setSelectedSchool(filtered[0]);
    }
  }, [mapsReady, searchQuery, regionFilter, mySchoolCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── KST 오늘 날짜 문자열 ────────────────────────────────────────────────
  const todayLabel = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  // ─── 렌더 ──────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>

      {/* ── 상단 바 ───────────────────────────────────────────────────── */}
      <div style={isMobile ? styles.topBarMobile : styles.topBar}>
        {/* 1행: 탭 네비게이션 + 카운트 */}
        <div style={styles.topRow}>
          <nav style={{ display: 'flex', gap: 4 }}>
            <span style={styles.logo}>🏫 고등학교</span>
            <Link href="/universities" style={styles.tabInactive}>🎓 대학교</Link>
          </nav>
          <span style={styles.countBadge}>
            {shownCount.toLocaleString()} / {totalCount.toLocaleString()}개
          </span>
        </div>
        {/* 2행: 검색 + 지역 필터 */}
        <div style={styles.searchRow}>
          <input
            type="text"
            placeholder="학교명 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={styles.searchInput}
          />
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            style={styles.select}
          >
            {REGIONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {/* ── 지도 컨테이너 ────────────────────────────────────────────── */}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* ── 범례 ─────────────────────────────────────────────────────── */}
      {mapsReady && !isMobile && (
        <div style={styles.legend}>
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <div key={type} style={styles.legendRow}>
              <div style={{ ...styles.legendDot, background: color }} />
              <span>{type}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── 로딩 오버레이 ────────────────────────────────────────────── */}
      {isLoading && (
        <div style={styles.overlay}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🏫</div>
          <p style={{ fontSize: 16, color: '#374151', margin: 0 }}>학교 데이터 불러오는 중…</p>
        </div>
      )}

      {/* ── 오류 메시지 ──────────────────────────────────────────────── */}
      {loadError && (
        <div style={styles.errorBox}>{loadError}</div>
      )}

      {/* ── 학교 정보 패널 ───────────────────────────────────────────── */}
      {selectedSchool && (
        <div style={isMobile ? styles.panelMobile : styles.panel}>
          {isMobile && <div style={styles.dragHandle} />}
          <button onClick={() => setSelectedSchool(null)} style={styles.closeBtn}>✕</button>

          <h2 style={styles.panelTitle}>{selectedSchool.name}</h2>

          {/* 우리 학교 등록/해제 */}
          <button
            onClick={() => handleMySchool(selectedSchool)}
            style={String(mySchoolCode) === String(selectedSchool.schoolCode)
              ? styles.mySchoolBtnActive : styles.mySchoolBtn}
          >
            {String(mySchoolCode) === String(selectedSchool.schoolCode)
              ? '⭐ 우리 학교' : '☆ 우리 학교 등록'}
          </button>

          {/* 태그 */}
          <div style={styles.tagRow}>
            {selectedSchool.type && (
              <Tag color={getTypeColor(selectedSchool.type)}>{selectedSchool.type || '일반고'}</Tag>
            )}
            {selectedSchool.establishment && (
              <Tag color="#6b7280">{selectedSchool.establishment}</Tag>
            )}
            {selectedSchool.genderType && selectedSchool.genderType !== '남여공학' && (
              <Tag color="#6b7280">{selectedSchool.genderType}</Tag>
            )}
            {selectedSchool.specialType && (
              <Tag color="#0891b2">{selectedSchool.specialType}</Tag>
            )}
          </div>

          {/* 기본 정보 */}
          <div style={{ borderTop: '1px solid #e5e7eb', padding: '16px 0 0' }}>
            <InfoRow icon="📍" label="주소" value={selectedSchool.address} />
            <InfoRow icon="📞" label="전화" value={selectedSchool.phone} />
            {selectedSchool.homepage && (
              <InfoRow icon="🌐" label="홈페이지">
                <a
                  href={
                    selectedSchool.homepage.startsWith('http')
                      ? selectedSchool.homepage
                      : 'http://' + selectedSchool.homepage
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#2563eb', fontSize: 13, wordBreak: 'break-all' }}
                >
                  {selectedSchool.homepage}
                </a>
              </InfoRow>
            )}
          </div>

          {/* 날씨 + 예보 */}
          <WeatherSection weather={weatherData?.current} forecast={weatherData?.forecast} loading={weatherLoading} />

          {/* 급식 */}
          <div style={styles.mealBox}>
            <div style={styles.mealHeader}>
              <span style={{ fontSize: 20 }}>🍱</span>
              <span style={styles.mealTitle}>오늘의 급식</span>
              <span style={styles.mealDate}>{todayLabel}</span>
            </div>

            {selectedSchool.meal &&
            selectedSchool.meal !== '급식 정보 없음' &&
            selectedSchool.meal !== '급식 없음' ? (
              <ul style={styles.menuList}>
                {selectedSchool.meal.split('\n').map((item, i) => (
                  <li key={i} style={styles.menuItem}>
                    <span style={{ color: '#d97706', marginRight: 6 }}>●</span>
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <p style={styles.noMeal}>오늘의 급식 정보가 없습니다.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 날씨 섹션 (실황 + 예보) ─────────────────────────────────────────────────
// 실황(getUltraSrtNcst): T1H, PTY, REH, RN1, WSD  (SKY 없음)
// 예보(getUltraSrtFcst): T1H, SKY, PTY, REH, RN1, WSD
const SKY_ICON  = { 1: '☀️', 3: '⛅', 4: '☁️' };
const PTY_LABEL = { 0: '맑음', 1: '비', 2: '비/눈', 3: '눈', 4: '소나기', 5: '빗방울', 6: '진눈깨비', 7: '눈날림' };
const PTY_ICON  = { 0: null, 1: '🌧️', 2: '🌨️', 3: '❄️', 4: '🌦️', 5: '🌧️', 6: '🌨️', 7: '🌨️' };

function getWeatherIcon(sky, pty) {
  if (pty != null && pty > 0) return PTY_ICON[pty] ?? '🌧️';
  return SKY_ICON[sky] ?? '☀️';
}

function WeatherSection({ weather, forecast, loading }) {
  // 현재 시각(KST) 이후의 예보만 필터링
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const kstDate = kstNow.toISOString().split('T')[0].replace(/-/g, '');
  const kstHHMM = String(kstNow.getUTCHours()).padStart(2, '0') + '00';
  const futureFc = (forecast ?? []).filter(
    (f) => f.fcstDate > kstDate || (f.fcstDate === kstDate && f.fcstTime > kstHHMM)
  ).slice(0, 6);

  // 현재 아이콘: 예보의 첫 항목 SKY + 실황 PTY
  const nearestSky = futureFc[0]?.SKY;
  const curPty = weather?.PTY ?? futureFc[0]?.PTY ?? 0;
  const curIcon = getWeatherIcon(nearestSky, curPty);
  const curLabel = curPty > 0 ? (PTY_LABEL[curPty] ?? '') : (nearestSky ? (PTY_LABEL[0]) : '맑음');

  if (loading) return (
    <div style={{ ...styles.weatherBox, color: '#6b7280', fontSize: 13, textAlign: 'center', padding: '14px 0' }}>
      날씨 불러오는 중…
    </div>
  );
  if (!weather && !futureFc.length) return null;

  return (
    <div style={styles.weatherBox}>
      <div style={styles.weatherHeader}>
        <span style={{ fontSize: 18 }}>🌡️</span>
        <span style={styles.weatherTitle}>현재 날씨</span>
      </div>

      {/* 현재 실황 */}
      {weather && (
        <div style={styles.weatherGrid}>
          <div style={styles.weatherItem}>
            <span style={{ fontSize: 22 }}>{curIcon}</span>
            <span style={styles.weatherVal}>{curLabel}</span>
            <span style={styles.weatherKey}>날씨</span>
          </div>
          <div style={styles.weatherItem}>
            <span style={{ fontSize: 22 }}>🌡️</span>
            <span style={styles.weatherVal}>{weather.T1H != null ? `${weather.T1H}°C` : '-'}</span>
            <span style={styles.weatherKey}>기온</span>
          </div>
          <div style={styles.weatherItem}>
            <span style={{ fontSize: 22 }}>💧</span>
            <span style={styles.weatherVal}>{weather.REH != null ? `${weather.REH}%` : '-'}</span>
            <span style={styles.weatherKey}>습도</span>
          </div>
          <div style={styles.weatherItem}>
            <span style={{ fontSize: 22 }}>🌂</span>
            <span style={styles.weatherVal}>{weather.RN1 != null ? `${weather.RN1}mm` : '-'}</span>
            <span style={styles.weatherKey}>강수</span>
          </div>
          <div style={styles.weatherItem}>
            <span style={{ fontSize: 22 }}>💨</span>
            <span style={styles.weatherVal}>{weather.WSD != null ? `${weather.WSD}m/s` : '-'}</span>
            <span style={styles.weatherKey}>풍속</span>
          </div>
        </div>
      )}

      {/* 6시간 예보 스트립 */}
      {futureFc.length > 0 && (
        <>
          <div style={styles.forecastLabel}>6시간 예보</div>
          <div style={styles.forecastRow}>
            {futureFc.map((f) => (
              <div key={f.fcstDate + f.fcstTime} style={styles.forecastItem}>
                <span style={styles.forecastTime}>{f.fcstTime.slice(0, 2)}시</span>
                <span style={{ fontSize: 20 }}>{getWeatherIcon(f.SKY, f.PTY)}</span>
                <span style={styles.forecastTemp}>{f.T1H != null ? `${f.T1H}°` : '-'}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── 서브 컴포넌트 ──────────────────────────────────────────────────────────
function Tag({ color, children }) {
  return (
    <span style={{
      background: color + '1a',
      color,
      border: `1px solid ${color}55`,
      padding: '3px 10px',
      borderRadius: 20,
      fontSize: 12,
      fontWeight: 600,
    }}>
      {children}
    </span>
  );
}

function InfoRow({ icon, label, value, children }) {
  if (!value && !children) return null;
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 2 }}>{label}</div>
        {children ?? <div style={{ fontSize: 13, color: '#111827' }}>{value}</div>}
      </div>
    </div>
  );
}

// ─── 인라인 스타일 ──────────────────────────────────────────────────────────
const styles = {
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    display: 'flex', flexDirection: 'column', gap: 8,
    padding: '10px 16px',
    background: 'white',
    boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
  },
  topBarMobile: {
    position: 'fixed', top: 0, left: 0, right: 0, zIndex: 10,
    display: 'flex', flexDirection: 'column', gap: 8,
    padding: '10px 12px',
    paddingTop: 'max(10px, env(safe-area-inset-top))',
    background: 'white',
    boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
  },
  topRow: {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  },
  searchRow: {
    display: 'flex', alignItems: 'center', gap: 8, width: '100%',
  },
  logo: {
    padding: '6px 12px', borderRadius: 8,
    background: '#1d4ed8', color: 'white',
    fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap',
  },
  tabInactive: {
    padding: '6px 12px', borderRadius: 8,
    background: '#f3f4f6', color: '#374151',
    fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap',
    textDecoration: 'none',
  },
  searchInput: {
    flex: 1, minWidth: 0,
    padding: '9px 12px', borderRadius: 8,
    border: '1px solid #d1d5db', fontSize: 14, outline: 'none',
  },
  select: {
    flexShrink: 0,
    padding: '9px 8px', borderRadius: 8,
    border: '1px solid #d1d5db', fontSize: 14,
    background: 'white', cursor: 'pointer', outline: 'none',
  },
  countBadge: {
    fontSize: 13, color: '#6b7280', whiteSpace: 'nowrap',
    background: '#f3f4f6', padding: '4px 10px', borderRadius: 20,
    marginLeft: 'auto', flexShrink: 0,
  },
  legend: {
    position: 'absolute', bottom: 36, left: 12, zIndex: 10,
    background: 'white', borderRadius: 10, padding: '10px 14px',
    boxShadow: '0 2px 10px rgba(0,0,0,0.12)', fontSize: 12,
  },
  legendRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  legendDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  overlay: {
    position: 'absolute', inset: 0,
    background: 'rgba(255,255,255,0.88)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    zIndex: 40,
  },
  errorBox: {
    position: 'absolute', top: 70, left: '50%', transform: 'translateX(-50%)',
    background: '#fee2e2', border: '1px solid #fca5a5', color: '#dc2626',
    padding: '12px 20px', borderRadius: 8, zIndex: 40, fontSize: 14,
    whiteSpace: 'nowrap',
  },
  panel: {
    position: 'absolute', top: 100, right: 0, bottom: 0,
    width: 'min(360px, 100vw)',
    background: 'white', zIndex: 20,
    boxShadow: '-4px 0 20px rgba(0,0,0,0.12)',
    overflowY: 'auto', padding: '16px 20px 20px',
  },
  panelMobile: {
    position: 'fixed', bottom: 0, left: 0, right: 0,
    maxHeight: '60vh', zIndex: 20,
    background: 'white',
    borderRadius: '20px 20px 0 0',
    boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
    overflowY: 'auto',
    padding: '8px 16px',
    paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
  },
  dragHandle: {
    width: 40, height: 4, borderRadius: 2,
    background: '#d1d5db',
    margin: '0 auto 12px', flexShrink: 0,
  },
  closeBtn: {
    position: 'absolute', top: 12, right: 12,
    background: 'none', border: 'none', fontSize: 18,
    cursor: 'pointer', color: '#6b7280',
  },
  panelTitle: {
    margin: '0 0 10px', fontSize: 18, fontWeight: 700,
    paddingRight: 28, color: '#111827', lineHeight: 1.4,
  },
  tagRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  mealBox: {
    marginTop: 16, borderRadius: 12,
    background: 'linear-gradient(135deg,#fef3c7,#fde68a)',
    padding: 16,
  },
  mealHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  mealTitle: { fontWeight: 700, fontSize: 15, color: '#92400e' },
  mealDate:  { fontSize: 12, color: '#a16207', marginLeft: 'auto' },
  menuList:  { margin: 0, padding: 0, listStyle: 'none' },
  menuItem:  { fontSize: 13, color: '#78350f', lineHeight: 1.9 },
  noMeal:    { fontSize: 13, color: '#a16207', fontStyle: 'italic', margin: 0 },
  weatherBox: {
    marginTop: 16, borderRadius: 12,
    background: 'linear-gradient(135deg,#eff6ff,#dbeafe)',
    padding: '14px 16px',
  },
  weatherHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  weatherTitle: { fontWeight: 700, fontSize: 15, color: '#1e40af' },
  weatherGrid: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 },
  weatherItem: {
    flex: '1 1 52px', minWidth: 52,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    background: 'rgba(255,255,255,0.7)', borderRadius: 8, padding: '8px 4px',
  },
  weatherVal: { fontSize: 13, fontWeight: 700, color: '#1e3a8a' },
  weatherKey: { fontSize: 11, color: '#3b82f6' },
  forecastLabel: { fontSize: 11, fontWeight: 700, color: '#3b82f6', marginTop: 10, marginBottom: 6 },
  forecastRow: { display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 },
  forecastItem: {
    minWidth: 48, flexShrink: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    background: 'rgba(255,255,255,0.75)', borderRadius: 8, padding: '6px 4px',
  },
  forecastTime: { fontSize: 11, fontWeight: 600, color: '#3b82f6' },
  forecastTemp: { fontSize: 13, fontWeight: 700, color: '#1e3a8a' },
  mySchoolBtn: {
    display: 'block', width: '100%', marginBottom: 12,
    padding: '8px 0', borderRadius: 8, border: '1.5px solid #d97706',
    background: '#fffbeb', color: '#92400e', fontWeight: 600, fontSize: 13,
    cursor: 'pointer', textAlign: 'center',
  },
  mySchoolBtnActive: {
    display: 'block', width: '100%', marginBottom: 12,
    padding: '8px 0', borderRadius: 8, border: 'none',
    background: '#f59e0b', color: 'white', fontWeight: 700, fontSize: 13,
    cursor: 'pointer', textAlign: 'center',
  },
};
