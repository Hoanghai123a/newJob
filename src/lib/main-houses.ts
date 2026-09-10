// Compatibility exports while existing screens migrate to the shared entity model.
export {
  fetchRecruitmentEntities as fetchMainHouses,
  isRecruitmentEntityActive,
  type RecruitmentEntityRecord as MainHouseRecord,
  type RecruitmentEntityStatus,
} from "./recruitment-entities";
