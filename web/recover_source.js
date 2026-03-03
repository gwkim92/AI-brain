import fs from "node:fs";
import path from "node:path";

const mapsDir = "/Users/woody/ai/brain/web/.next/dev/static/chunks/";
const files = fs.readdirSync(mapsDir).filter((file) => file.endsWith(".map"));
const targetFile = "Jarvis3DCore.tsx";

for (const file of files) {
  const mapPath = path.join(mapsDir, file);
  try {
    const mapData = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    if (!mapData.sources) continue;
    let foundIndex = -1;
    for (let i = 0; i < mapData.sources.length; i++) {
      if (mapData.sources[i] && mapData.sources[i].includes(targetFile)) {
        foundIndex = i;
        break;
      }
    }
    if (foundIndex !== -1 && mapData.sourcesContent) {
      const content = mapData.sourcesContent[foundIndex];
      // Clean up webpack specific pathing if needed
      fs.writeFileSync("/Users/woody/ai/brain/web/src/components/ui/Jarvis3DCore.tsx", content);
      console.log(`Successfully recovered Jarvis3DCore.tsx from ${file}!`);
      process.exit(0);
    }
  } catch {}
}
console.log("Could not find Jarvis3DCore in any source map.");
