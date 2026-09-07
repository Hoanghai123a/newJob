import path from 'node:path';
import { pathToFileURL } from 'node:url';

const skillDir = 'C:/Users/admin/.codex/plugins/cache/openai-primary-runtime/presentations/26.904.11930/skills/presentations';
const workspaceDir = 'D:/My App/newApp';
const candidatePath = 'D:/My App/newApp/.pptx-work/candidate.pptx';
const finalPath = 'D:/My App/newApp/presentation-output/Tuyen-Dung-4.0-de-xuat-so-hoa-van-hanh-nhan-su-final.pptx';
const { finalizePresentation } = await import(pathToFileURL(path.join(skillDir, 'container_tools/artifact_tool_utils.mjs')).href);

const result = await finalizePresentation({
  workspaceDir,
  candidatePath,
  finalPath,
  pythonExecutable: 'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
  integrityValidatorPath: path.join(skillDir, 'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(skillDir, 'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-bullet-geometry', '--validate-heading-fit', '--require-native-table-slide', '5', '--require-native-table-slide', '7'],
  requiredNativeTableOwnerSlides: [5, 7],
  requiredNativeChartOwnerSlides: [],
  explicitTotalSlideCount: 11,
  fontPolicy: { basis: 'design', families: ['Arial'] },
  verifyArtifactToolImport: true,
  receiptPath: 'D:/My App/newApp/.pptx-work/.codex-finalizer/Tuyen-Dung-4.0-de-xuat-so-hoa-van-hanh-nhan-su-final.validation.json',
});
console.log(JSON.stringify(result));
