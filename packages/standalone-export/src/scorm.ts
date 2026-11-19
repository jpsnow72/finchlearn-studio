/**
 * SCORM packaging (issue #56): a self-contained zip that plays the
 * rendered project video inside a SCORM runtime.
 *
 * Completion rule (documented, and implemented in the player page): the
 * SCO reports completion when the video ends. A fallback marks
 * completion once playback passes 95 percent, which covers runtimes and
 * browsers where the ended event is unreliable. SCORM 1.2 writes
 * cmi.core.lesson_status = "completed"; SCORM 2004 writes
 * cmi.completion_status = "completed" and cmi.success_status = "passed".
 * Nothing in the package contacts a server or needs a FinchLearn
 * account: the video and poster are embedded files, and when no SCORM
 * API is present the page simply plays as a plain video page.
 *
 * Package contents are deterministic: fixed identifiers, no timestamps,
 * no random values, so two builds of the same project diff cleanly.
 * Real-runtime proof of this package shape in SCORM Cloud and an LRS is
 * issue #51's ship-point work, not asserted here.
 */
import { buildZip, type ZipEntryInput } from "./zip.js";
import {
  requireScenes,
  sceneFrameFileName,
  slugifyFilePart,
  xmlEscape,
  type StandaloneVideoInput,
} from "./model.js";

export type ScormVersion = "1.2" | "2004";

export const SCORM_VIDEO_PATH = "media/video.mp4";
export const SCORM_LAUNCH_PATH = "index.html";

export function scormPosterPath(input: StandaloneVideoInput): string {
  return `media/${sceneFrameFileName(input.scenes[0], 0)}`;
}

export function scormPackageFileName(projectName: string, version: ScormVersion): string {
  return `${slugifyFilePart(projectName)}-scorm${version === "1.2" ? "12" : "2004"}.zip`;
}

function playerPage(input: StandaloneVideoInput, version: ScormVersion): string {
  const title = xmlEscape(input.name);
  const api12 = version === "1.2";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  html, body { margin: 0; padding: 0; background: #111; height: 100%; }
  body { display: flex; align-items: center; justify-content: center; }
  video { width: 100%; height: 100%; max-height: 100vh; background: #000; }
</style>
</head>
<body>
<video id="lesson" controls playsinline preload="auto" poster="${scormPosterPath(input)}" src="${SCORM_VIDEO_PATH}"></video>
<script>
"use strict";
// Completion rule: report completion when the video ends, or once
// playback passes 95 percent (fallback for unreliable ended events).
var reported = false;
function findApi(win, name) {
  var depth = 0;
  while (win && depth < 500) {
    if (win[name]) return win[name];
    if (win.parent === win) break;
    win = win.parent;
    depth++;
  }
  return null;
}
function findAnyApi(name) {
  var api = findApi(window, name);
  if (!api && window.opener && typeof window.opener !== "undefined") api = findApi(window.opener, name);
  return api;
}
var api = findAnyApi(${api12 ? '"API"' : '"API_1484_11"'});
var initialized = false;
if (api) {
  try { initialized = ${api12 ? 'api.LMSInitialize("") === "true"' : 'api.Initialize("") === "true"'}; } catch (e) { initialized = false; }
}
function reportComplete() {
  if (reported || !api || !initialized) return;
  reported = true;
  try {
${api12
  ? '    api.LMSSetValue("cmi.core.lesson_status", "completed");\n    api.LMSCommit("");'
  : '    api.SetValue("cmi.completion_status", "completed");\n    api.SetValue("cmi.success_status", "passed");\n    api.Commit("");'}
  } catch (e) { /* The video keeps playing even if the LMS write fails. */ }
}
var video = document.getElementById("lesson");
video.addEventListener("ended", reportComplete);
video.addEventListener("timeupdate", function () {
  if (video.duration && isFinite(video.duration) && video.currentTime / video.duration >= 0.95) reportComplete();
});
window.addEventListener("beforeunload", function () {
  if (!api || !initialized) return;
  try { ${api12 ? 'api.LMSFinish("");' : 'api.Terminate("");'} } catch (e) {}
});
</script>
</body>
</html>
`;
}

export function scormManifest(input: StandaloneVideoInput, version: ScormVersion): string {
  const title = xmlEscape(input.name);
  const files = [SCORM_LAUNCH_PATH, SCORM_VIDEO_PATH, scormPosterPath(input)];
  const fileXml = files.map((f) => `      <file href="${f}"/>`).join("\n");
  if (version === "1.2") {
    return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-1" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>${title}</title>
      <item identifier="ITEM-1" identifierref="RES-1" isvisible="true">
        <title>${title}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="${SCORM_LAUNCH_PATH}">
${fileXml}
    </resource>
  </resources>
</manifest>
`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="MANIFEST-1" version="1.3"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="ORG-1">
    <organization identifier="ORG-1">
      <title>${title}</title>
      <item identifier="ITEM-1" identifierref="RES-1" isvisible="true">
        <title>${title}</title>
        <imsss:sequencing>
          <imsss:objectives>
            <imsss:primaryObjective objectiveID="OBJ-1"/>
          </imsss:objectives>
        </imsss:sequencing>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-1" type="webcontent" adlcp:scormType="sco" href="${SCORM_LAUNCH_PATH}">
${fileXml}
    </resource>
  </resources>
</manifest>
`;
}

/** Build the SCORM zip bytes for a project and its rendered video. */
export function buildScormPackage(input: StandaloneVideoInput, version: ScormVersion): Uint8Array {
  requireScenes(input);
  if (!input.videoBytes || input.videoBytes.length === 0) {
    throw new Error("The rendered video is missing. Render the MP4 first, then export SCORM.");
  }
  const encoder = new TextEncoder();
  const entries: ZipEntryInput[] = [
    { name: "imsmanifest.xml", data: encoder.encode(scormManifest(input, version)) },
    { name: SCORM_LAUNCH_PATH, data: encoder.encode(playerPage(input, version)) },
    { name: SCORM_VIDEO_PATH, data: input.videoBytes },
    { name: scormPosterPath(input), data: input.scenes[0].framePng },
  ];
  return buildZip(entries);
}
