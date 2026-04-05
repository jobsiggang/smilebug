import mongoose from 'mongoose';

// 기상청 초단기실황 캐시 (nx, ny 기준 1시간마다 갱신)
// category 코드 설명:
//   T1H  기온(°C)   RN1  1시간강수량(mm)
//   PTY  강수형태(0없음/1비/2비눈/3눈/5빗방울/6진눈깨비/7눈날림)
//   REH  습도(%)    WSD  풍속(m/s)
//   ※ SKY(하늘상태)는 초단기실황에 없음 → 초단기예보(getUltraSrtFcst) 필요
const WeatherCacheSchema = new mongoose.Schema({
  nx:       { type: Number, required: true },
  ny:       { type: Number, required: true },
  baseDate: { type: String },   // YYYYMMDD
  baseTime: { type: String },   // HHMM
  T1H:  Number,   // 기온
  RN1:  Number,   // 강수량
  PTY:  Number,   // 강수형태
  REH:  Number,   // 습도
  WSD:  Number,   // 풍속
  updatedAt: { type: Date, default: Date.now },
});

WeatherCacheSchema.index({ nx: 1, ny: 1 }, { unique: true });

export default mongoose.models.WeatherCache ||
  mongoose.model('WeatherCache', WeatherCacheSchema);
