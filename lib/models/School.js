import mongoose from 'mongoose';

const SchoolSchema = new mongoose.Schema({
  schoolId:      { type: String, required: true, unique: true }, // 학교ID (B000012345)
  name:          { type: String, required: true },               // 학교명
  atptCode:      { type: String, required: true },               // 시도교육청코드 (B10, J10...)
  schoolCode:    { type: String, required: true },               // 행정표준코드 (NEIS SD_SCHUL_CODE)
  lat:           { type: Number },
  lng:           { type: Number },
  address:       { type: String },                               // 소재지도로명주소
  phone:         { type: String },
  homepage:      { type: String },
  region:        { type: String },                               // 시도명
  type:          { type: String },                               // 고등학교구분명 (일반고, 특목고...)
  establishment: { type: String },                               // 설립명 (공립, 사립)
  genderType:    { type: String },                               // 남녀공학구분명
  specialType:   { type: String },                               // 특수목적고등학교계열명
});

SchoolSchema.index({ atptCode: 1, schoolCode: 1 });

export default mongoose.models.School || mongoose.model('School', SchoolSchema);
