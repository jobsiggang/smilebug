import mongoose from 'mongoose';

// 기상청 격자 정보 (행정구역 → nx, ny 매핑)
const WeatherGridSchema = new mongoose.Schema({
  regionCode: { type: String, required: true, unique: true }, // 행정구역코드
  r1: { type: String },  // 1단계 (시도)
  r2: { type: String },  // 2단계 (시군구)
  r3: { type: String },  // 3단계 (읍면동)
  nx:  { type: Number, required: true },
  ny:  { type: Number, required: true },
  lat: { type: Number },
  lng: { type: Number },
});

WeatherGridSchema.index({ nx: 1, ny: 1 });

export default mongoose.models.WeatherGrid ||
  mongoose.model('WeatherGrid', WeatherGridSchema);
