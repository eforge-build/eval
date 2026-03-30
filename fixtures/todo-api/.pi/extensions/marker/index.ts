import { writeFileSync } from "node:fs";
import { join } from "node:path";

export default function markerExtension(_api: unknown) {
  writeFileSync(join(process.cwd(), ".pi-extension-loaded"), "");
}
