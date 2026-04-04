'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// ─── 상수 ──────────────────────────────────────────────────────────────────
const REGIONS = [
  '전체', '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
];

const UNIV_COLOR = '#0d9488'; // 청록색

function getRegion(address) {
  if (!address) return '';
  const hits = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
    '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
  return hits.find((r) => address.includes(r)) ?? '';
}

function makeMarkerSVG(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">
    <path fill="${color}" stroke="white" stroke-width="1.5"
      d="M11 0C4.93 0 0 4.93 0 11c0 8.25 11 19 11 19S22 19.25 22 11C22 4.93 17.07 0 11 0z"/>
    <circle cx="11" cy="11" r="4.5" fill="white"/>
  </svg>`;
}

// ─── 컴포넌트 ───────────────────────────────────────────────────────────────
export default function UniversityMapPage() {
  const mapContainerRef = useRef(null);
  const mapRef          = useRef(null);
  const clustererRef    = useRef(null);
  const univsRef        = useRef([]);

  const [mapsReady, setMapsReady]           = useState(false);
  const [selectedUniv, setSelectedUniv]     = useState(null);
  const [searchQuery, setSearchQuery]       = useState('');
  const [regionFilter, setRegionFilter]     = useState('전체');
  const [shownCount, setShownCount]         = useState(0);
  const [totalCount, setTotalCount]         = useState(0);
  const [isLoading, setIsLoading]           = useState(true);
  const [loadError, setLoadError]           = useState(null);

  // ── 1) SDK + 데이터 병렬 로드 ───────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

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

    const dataPromise = fetch('/universities.json')
      .then((res) => {
        if (!res.ok) throw new Error('대학 데이터를 불러오지 못했습니다.');
        return res.json();
      })
      .then((data) =>
        data
          .filter((u) => u.lat && u.lng)
          .map((u) => ({ ...u, region: getRegion(u.address) })),
      );

    Promise.all([sdkPromise, dataPromise])
      .then(([, univs]) => {
        if (!mounted) return;
        univsRef.current = univs;
        setTotalCount(univs.length);
        initMap(univs);
        setMapsReady(true);
        setIsLoading(false);
      })
      .catch((err) => {
        if (mounted) { setLoadError(err.message); setIsLoading(false); }
      });

    return () => { mounted = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2) 지도 초기화 ──────────────────────────────────────────────────────
  function initMap(univs) {
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
        { width: '40px', height: '40px', background: 'rgba(13,148,136,0.85)', borderRadius: '50%', color: '#fff', textAlign: 'center', lineHeight: '40px',  fontSize: '13px', fontWeight: '700' },
        { width: '50px', height: '50px', background: 'rgba(13,148,136,0.9)',  borderRadius: '50%', color: '#fff', textAlign: 'center', lineHeight: '50px',  fontSize: '13px', fontWeight: '700' },
        { width: '60px', height: '60px', background: 'rgba(13,148,136,0.95)', borderRadius: '50%', color: '#fff', textAlign: 'center', lineHeight: '60px', fontSize: '14px', fontWeight: '700' },
      ],
    });
    clustererRef.current = clusterer;

    const count = renderMarkers(univs);
    setShownCount(count);
  }

  // ── 3) 마커 렌더링 ──────────────────────────────────────────────────────
  function renderMarkers(univs) {
    if (!clustererRef.current) return 0;
    clustererRef.current.clear();

    const img = new kakao.maps.MarkerImage(
      'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(makeMarkerSVG(UNIV_COLOR)),
      new kakao.maps.Size(22, 30),
      { offset: new kakao.maps.Point(11, 30) },
    );

    const markers = univs.map((univ) => {
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(Number(univ.lat), Number(univ.lng)),
        image: img,
        title: univ.name,
      });
      kakao.maps.event.addListener(marker, 'click', () => setSelectedUniv(univ));
      return marker;
    });

    clustererRef.current.addMarkers(markers);
    return markers.length;
  }

  // ── 4) 검색·필터 ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapsReady) return;

    const q = searchQuery.trim().toLowerCase();
    const filtered = univsRef.current.filter((u) => {
      const matchRegion = regionFilter === '전체' || u.region === regionFilter;
      const matchSearch = !q || u.name?.toLowerCase().includes(q);
      return matchRegion && matchSearch;
    });

    const count = renderMarkers(filtered);
    setShownCount(count);

    if (filtered.length === 1) {
      mapRef.current.setCenter(new kakao.maps.LatLng(Number(filtered[0].lat), Number(filtered[0].lng)));
      mapRef.current.setLevel(5);
      setSelectedUniv(filtered[0]);
    }
  }, [mapsReady, searchQuery, regionFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── 렌더 ───────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>

      {/* ── 상단 바 ───────────────────────────────────────────────────── */}
      <div style={styles.topBar}>
        {/* 탭 네비게이션 */}
        <nav style={styles.tabNav}>
          <Link href="/" style={styles.tabInactive}>🏫 고등학교</Link>
          <span style={styles.tabActive}>🎓 대학교</span>
        </nav>

        <input
          type="text"
          placeholder="대학명 검색..."
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

      {/* ── 지도 ─────────────────────────────────────────────────────── */}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* ── 로딩 오버레이 ────────────────────────────────────────────── */}
      {isLoading && (
        <div style={styles.overlay}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎓</div>
          <p style={{ fontSize: 16, color: '#374151', margin: 0 }}>대학 데이터 불러오는 중…</p>
        </div>
      )}

      {/* ── 오류 ─────────────────────────────────────────────────────── */}
      {loadError && (
        <div style={styles.errorBox}>{loadError}</div>
      )}

      {/* ── 대학 정보 패널 ───────────────────────────────────────────── */}
      {selectedUniv && (
        <div style={styles.panel}>
          <button onClick={() => setSelectedUniv(null)} style={styles.closeBtn}>✕</button>

          <h2 style={styles.panelTitle}>{selectedUniv.name}</h2>

          <div style={styles.tagRow}>
            <Tag color={UNIV_COLOR}>대학교</Tag>
            {selectedUniv.region && <Tag color="#6b7280">{selectedUniv.region}</Tag>}
          </div>

          <div style={{ borderTop: '1px solid #e5e7eb', padding: '16px 0 0' }}>
            <InfoRow icon="📍" label="주소" value={selectedUniv.address} />
            <InfoRow icon="📞" label="전화" value={selectedUniv.phone || '정보없음'} />
            {selectedUniv.homepage && (
              <InfoRow icon="🌐" label="홈페이지">
                <a
                  href={
                    selectedUniv.homepage.startsWith('http')
                      ? selectedUniv.homepage
                      : 'http://' + selectedUniv.homepage
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#0d9488', fontSize: 13, wordBreak: 'break-all' }}
                >
                  {selectedUniv.homepage}
                </a>
              </InfoRow>
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
    padding: '8px 16px',
    background: 'white',
    boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
  },
  tabNav: {
    display: 'flex', gap: 4, flexShrink: 0,
  },
  tabActive: {
    padding: '6px 14px', borderRadius: 8,
    background: '#0d9488', color: 'white',
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
};
