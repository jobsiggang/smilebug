/**
 * scripts/seed.js
 * school_data.csv → MongoDB schoolmaps.schools 컬렉션으로 고등학교 데이터 적재
 *
 * 실행 방법:
 *   cp .env.local.example .env.local    # 환경변수 설정
 *   node scripts/seed.js
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const { parse } = require('csv-parse/sync');
const mongoose  = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI 환경변수를 .env.local에 설정해주세요.');
  process.exit(1);
}

// ─── Mongoose 스키마 (lib/models/School.js 와 동일하게 유지) ───────────────
const SchoolSchema = new mongoose.Schema({
  schoolId:      { type: String, required: true, unique: true },
  name:          { type: String, required: true },
  atptCode:      { type: String, required: true },
  schoolCode:    { type: String, required: true },
  lat:           Number,
  lng:           Number,
  address:       String,
  phone:         String,
  homepage:      String,
  region:        String,
  type:          String,
  establishment: String,
  genderType:    String,
  specialType:   String,
});
SchoolSchema.index({ atptCode: 1, schoolCode: 1 });
const School = mongoose.models.School || mongoose.model('School', SchoolSchema);

// ─── 메인 ───────────────────────────────────────────────────────────────────
async function main() {
  const csvPath = path.join(__dirname, '..', 'school_data.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV 파일을 찾을 수 없습니다: ${csvPath}`);
    process.exit(1);
  }

  console.log('📂 CSV 파싱 중...');
  const raw = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  // 고등학교 & 운영 중인 학교만 필터링
  const highSchools = rows.filter(
    (r) => r['학교급구분'] === '고등학교' && r['운영상태'] === '운영',
  );
  console.log(`🏫 고등학교(운영) 필터링: ${highSchools.length}개`);

  // 행정표준코드가 없거나 위도·경도가 없는 행 제외
  const valid = highSchools.filter((r) => {
    const code = String(r['행정표준코드'] ?? '').trim();
    const lat  = parseFloat(r['위도']);
    const lng  = parseFloat(r['경도']);
    return code && !isNaN(lat) && !isNaN(lng);
  });
  const skipped = highSchools.length - valid.length;
  if (skipped > 0) console.warn(`⚠️  ${skipped}개 행은 코드/좌표 누락으로 제외`);

  // MongoDB 연결
  console.log('🔌 MongoDB 연결 중...');
  await mongoose.connect(MONGODB_URI, { bufferCommands: false });
  console.log('✅ MongoDB 연결 성공');

  // 배치 upsert (bulkWrite)
  const BATCH = 500;
  let upserted = 0;

  for (let i = 0; i < valid.length; i += BATCH) {
    const batch = valid.slice(i, i + BATCH);

    const ops = batch.map((r) => ({
      updateOne: {
        filter: { schoolId: r['학교ID'] },
        update: {
          $set: {
            schoolId:      r['학교ID'],
            name:          r['학교명'],
            atptCode:      String(r['시도교육청코드_y'] ?? '').trim(),
            schoolCode:    String(r['행정표준코드']).trim(),
            lat:           parseFloat(r['위도']),
            lng:           parseFloat(r['경도']),
            address:       r['소재지도로명주소'] || r['도로명주소'] || '',
            phone:         r['전화번호'] || '',
            homepage:      r['홈페이지주소'] || '',
            region:        r['시도명'] || '',
            type:          r['고등학교구분명'] || '',
            establishment: r['설립명'] || '',
            genderType:    r['남녀공학구분명'] || '',
            specialType:   r['특수목적고등학교계열명'] || '',
          },
        },
        upsert: true,
      },
    }));

    await School.bulkWrite(ops, { ordered: false });
    upserted += batch.length;
    process.stdout.write(`\r  진행: ${upserted} / ${valid.length}`);
  }

  console.log(`\n🎉 시드 완료! 총 ${upserted}개 학교가 MongoDB에 저장되었습니다.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌ 시드 실패:', err);
  process.exit(1);
});
