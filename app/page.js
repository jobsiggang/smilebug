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
  }

  // ── 3) 마커 렌더링 (필터 적용) ───────────────────────────────────────────
  function renderMarkers(schools) {
    if (!clustererRef.current) return 0;
    clustererRef.current.clear();

    const markers = schools
      .filter((s) => !isNaN(s.lat) && !isNaN(s.lng))
      .map((school) => {
        const img = new kakao.maps.MarkerImage(
          'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(makeMarkerSVG(getTypeColor(school.type))),
          new kakao.maps.Size(22, 30),
          { offset: new kakao.maps.Point(11, 30) },
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

  // ── 4) 검색·필터 변경 시 마커 재렌더링 ──────────────────────────────────
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
  }, [mapsReady, searchQuery, regionFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── KST 오늘 날짜 문자열 ────────────────────────────────────────────────
  const todayLabel = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString().split('T')[0];

  // ─── 렌더 ──────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>

      {/* ── 상단 바 ───────────────────────────────────────────────────── */}
      <div style={styles.topBar}>
        {/* 탭 네비게이션 */}
        <nav style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <span style={styles.logo}>🏫 고등학교</span>
          <Link href="/universities" style={styles.tabInactive}>🎓 대학교</Link>
        </nav>

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

        <span style={styles.countBadge}>
          {shownCount.toLocaleString()} / {totalCount.toLocaleString()}개
        </span>
      </div>

      {/* ── 지도 컨테이너 ────────────────────────────────────────────── */}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* ── 범례 ─────────────────────────────────────────────────────── */}
      {mapsReady && (
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
        <div style={styles.panel}>
          <button onClick={() => setSelectedSchool(null)} style={styles.closeBtn}>✕</button>

          <h2 style={styles.panelTitle}>{selectedSchool.name}</h2>

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
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    padding: '10px 16px',
    background: 'white',
    boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
  },
  logo: {
    padding: '6px 14px', borderRadius: 8,
    background: '#1d4ed8', color: 'white',
    fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap',
  },
  tabInactive: {
    padding: '6px 14px', borderRadius: 8,
    background: '#f3f4f6', color: '#374151',
    fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap',
    textDecoration: 'none',
  },
  searchInput: {
    flex: 1, minWidth: 140, maxWidth: 240,
    padding: '7px 12px', borderRadius: 8,
    border: '1px solid #d1d5db', fontSize: 14, outline: 'none',
  },
  select: {
    padding: '7px 10px', borderRadius: 8,
    border: '1px solid #d1d5db', fontSize: 14,
    background: 'white', cursor: 'pointer', outline: 'none',
  },
  countBadge: {
    fontSize: 13, color: '#6b7280', whiteSpace: 'nowrap',
    background: '#f3f4f6', padding: '4px 10px', borderRadius: 20,
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
    position: 'absolute', top: 52, right: 0, bottom: 0,
    width: 'min(340px, 100vw)',
    background: 'white', zIndex: 20,
    boxShadow: '-4px 0 20px rgba(0,0,0,0.12)',
    overflowY: 'auto', padding: 20,
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
};
