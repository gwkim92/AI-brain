import fs from "node:fs";
import path from "node:path";

const mapsDir = "/Users/woody/ai/brain/web/.next/dev/static/chunks/";
const files = fs.readdirSync(mapsDir).filter((file) => file.endsWith(".map"));

for (const file of files) {
  const mapPath = path.join(mapsDir, file);
  try {
    const mapData = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    if (!mapData.sources) continue;
    
    for (let i = 0; i < mapData.sources.length; i++) {
        const sourcePath = mapData.sources[i];
        if (sourcePath && sourcePath.includes("src/components/layout/Sidebar.tsx")) {
            console.log("Sidebar.tsx found in " + file);
            fs.mkdirSync("/Users/woody/ai/brain/web/src/components/layout", { recursive: true });
            fs.writeFileSync("/Users/woody/ai/brain/web/src/components/layout/Sidebar.tsx", mapData.sourcesContent[i]);
            console.log("Recovered Sidebar.tsx");
        }
        if (sourcePath && sourcePath.includes("src/components/layout/RightPanel.tsx")) {
            console.log("RightPanel.tsx found in " + file);
            fs.mkdirSync("/Users/woody/ai/brain/web/src/components/layout", { recursive: true });
            fs.writeFileSync("/Users/woody/ai/brain/web/src/components/layout/RightPanel.tsx", mapData.sourcesContent[i]);
            console.log("Recovered RightPanel.tsx");
        }
        if (sourcePath && sourcePath.includes("src/app/page.tsx")) {
            console.log("page.tsx found in " + file);
            fs.writeFileSync("/Users/woody/ai/brain/web/src/app/page.tsx", mapData.sourcesContent[i]);
            console.log("Recovered page.tsx");
        }
    }
  } catch {}
}
console.log("Done scanning.");
