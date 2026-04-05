/**
 * scripts/seed-weather-grid.js
 * 기상청_격자_위경도.csv → MongoDB weathergrids 컬렉션 적재
 *
 * 실행:  node scripts/seed-weather-grid.js
 */
'use strict';

const path      = require('path');
const fs        = require('fs');
const { parse } = require('csv-parse/sync');
const mongoose  = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('❌ MONGODB_URI 없음'); process.exit(1); }

const WeatherGridSchema = new mongoose.Schema({
  regionCode: { type: String, required: true, unique: true },
  r1: String, r2: String, r3: String,
  nx: Number, ny: Number,
  lat: Number, lng: Number,
});
WeatherGridSchema.index({ nx: 1, ny: 1 });
const WeatherGrid = mongoose.models.WeatherGrid ||
  mongoose.model('WeatherGrid', WeatherGridSchema);

async function main() {
  const csvPath = path.join(__dirname, '..', '기상청_격자_위경도.csv');
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ 파일 없음: ${csvPath}`); process.exit(1);
  }

  const raw  = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(raw, { columns: true, skip_empty_lines: true, trim: true });

  // 읍면동(3단계) 있는 행만 → 가장 세밀한 격자
  const valid = rows.filter((r) => r['3단계'] && r['격자 X'] && r['격자 Y']);
  console.log(`📂 총 ${rows.length}행 중 읍면동 있는 ${valid.length}행 적재`);

  await mongoose.connect(MONGODB_URI, { bufferCommands: false });
  console.log('✅ MongoDB 연결');

  const BATCH = 500;
  let count = 0;

  for (let i = 0; i < valid.length; i += BATCH) {
    const ops = valid.slice(i, i + BATCH).map((r) => ({
      updateOne: {
        filter: { regionCode: r['행정구역코드'] },
        update: {
          $set: {
            regionCode: r['행정구역코드'],
            r1: r['1단계'] || '',
            r2: r['2단계'] || '',
            r3: r['3단계'] || '',
            nx: Number(r['격자 X']),
            ny: Number(r['격자 Y']),
            lat: parseFloat(r['위도(초/100)']) || 0,
            lng: parseFloat(r['경도(초/100)']) || 0,
          },
        },
        upsert: true,
      },
    }));
    await WeatherGrid.bulkWrite(ops, { ordered: false });
    count += ops.length;
    process.stdout.write(`\r  ${count} / ${valid.length}`);
  }

  console.log(`\n🎉 완료! ${count}개 격자 저장`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
