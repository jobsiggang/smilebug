import mongoose from 'mongoose';

const MealSchema = new mongoose.Schema({
  schoolCode: { type: String, required: true }, // 행정표준코드
  atptCode:   { type: String, required: true }, // 시도교육청코드
  date:       { type: String, required: true }, // YYYYMMDD 형식
  menu:       { type: String, default: '급식 없음' },
  updatedAt:  { type: Date, default: Date.now },
});

// (schoolCode + date) 복합 유니크 인덱스
MealSchema.index({ schoolCode: 1, date: 1 }, { unique: true });

export default mongoose.models.Meal || mongoose.model('Meal', MealSchema);
