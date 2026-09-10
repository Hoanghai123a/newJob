import { pathToFileURL } from 'node:url';
const m = await import(pathToFileURL('C:/Users/admin/.codex/plugins/cache/openai-primary-runtime/presentations/26.904.11930/skills/presentations/container_tools/artifact_tool_utils.mjs').href);
console.log('default', m.resolvePresentationFont());
console.log('arial', m.resolvePresentationFont({fontFamily:'Arial'}));
console.log('poppins', m.resolvePresentationFont({fontFamily:'Poppins'}));
