import mongoose from 'mongoose';

// 초단기예보 캐시 (nx, ny 기준, 6시간마다 갱신)
// getUltraSrtFcst — 발표 시점부터 6시간 예보
const ItemSchema = new mongoose.Schema({
  fcstDate: String,   // YYYYMMDD
  fcstTime: String,   // HHMM (e.g. "1900")
  T1H: Number,        // 기온(°C)
  SKY: Number,        // 하늘상태 (1맑음/3구름많음/4흐림)
  PTY: Number,        // 강수형태 (0없음/1비/2비눈/3눈/4소나기)
  RN1: Number,        // 강수량(mm)
  REH: Number,        // 습도(%)
  WSD: Number,        // 풍속(m/s)
}, { _id: false });

const WeatherForecastSchema = new mongoose.Schema({
  nx: { type: Number, required: true },
  ny: { type: Number, required: true },
  baseDate: String,
  baseTime: String,
  items: [ItemSchema],
  updatedAt: { type: Date, default: Date.now },
});

WeatherForecastSchema.index({ nx: 1, ny: 1 }, { unique: true });

export default mongoose.models.WeatherForecast ||
  mongoose.model('WeatherForecast', WeatherForecastSchema);
