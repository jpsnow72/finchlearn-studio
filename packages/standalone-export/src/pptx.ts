/**
 * PowerPoint export (issue #56): one slide per scene.
 *
 * Each slide is the scene frame as a full-bleed picture, sized from the
 * frame's real pixel dimensions at 96 dpi so the deck keeps the project
 * aspect. The scene title and its dialogue or script lines go into the
 * speaker notes for that slide (see sceneNotesText). The package is a
 * plain OOXML zip built from small static parts: no library, no
 * timestamps, deterministic output for the same project.
 */
import { buildZip, type ZipEntryInput } from "./zip.js";
import { pngInfo } from "./png.js";
import {
  requireScenes,
  sceneNotesText,
  slugifyFilePart,
  xmlEscape,
  type StandaloneProjectInput,
} from "./model.js";

const EMU_PER_PIXEL = 9525; // 914400 EMU per inch at 96 dpi
const NS = {
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  p: "http://schemas.openxmlformats.org/presentationml/2006/main",
};
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";

export function pptxFileName(projectName: string): string {
  return `${slugifyFilePart(projectName)}.pptx`;
}

export function slideSizeEmu(framePng: Uint8Array): { cx: number; cy: number } {
  const info = pngInfo(framePng);
  return { cx: info.width * EMU_PER_PIXEL, cy: info.height * EMU_PER_PIXEL };
}

function slideXml(index: number, size: { cx: number; cy: number }): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:pic>
        <p:nvPicPr><p:cNvPr id="2" name="Scene ${index + 1} frame"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
        <p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${size.cx}" cy="${size.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
      </p:pic>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>
`;
}

function notesSlideXml(notesText: string): string {
  const paragraphs = notesText
    .split("\n")
    .map((line) =>
      line === ""
        ? "          <a:p/>"
        : `          <a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${xmlEscape(line)}</a:t></a:r><a:endParaRPr lang="en-US" dirty="0"/></a:p>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="1"/></p:nvPr></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6858000" cy="3651250"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
${paragraphs}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:notes>
`;
}

function relsXml(targets: { id: string; type: string; target: string }[]): string {
  const items = targets
    .map((t) => `  <Relationship Id="${t.id}" Type="${t.type}" Target="${t.target}"/>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${REL}">
${items}
</Relationships>
`;
}

const RT = {
  officeDocument: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
  slide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide",
  slideMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster",
  slideLayout: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout",
  notesMaster: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster",
  notesSlide: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide",
  theme: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
  image: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
  coreProps: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
  appProps: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
};

const SLIDE_MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="2800"/></a:lvl1pPr></p:titleStyle>
    <p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle>
    <p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle>
  </p:txStyles>
</p:sldMaster>
`;

const SLIDE_LAYOUT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>
`;

const NOTES_MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle>
</p:notesMaster>
`;

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="${NS.a}" name="FinchLearn Studio">
  <a:themeElements>
    <a:clrScheme name="Studio">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F497D"/></a:dk2>
      <a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
      <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
      <a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
      <a:accent4><a:srgbClr val="8064A2"/></a:accent4>
      <a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
      <a:accent6><a:srgbClr val="F79646"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
      <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Studio">
      <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Studio">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>
`;

/** Build the .pptx bytes for a project: one slide per scene. */
export function buildPptx(input: StandaloneProjectInput): Uint8Array {
  const scenes = requireScenes(input);
  const size = slideSizeEmu(scenes[0].framePng);
  const encoder = new TextEncoder();
  const enc = (s: string) => encoder.encode(s);
  const n = scenes.length;

  const overrides = [
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`,
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`,
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
    `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>`,
    ...scenes.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`),
    ...scenes.map((_, i) => `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`),
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
  ].join("\n  ");
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${CT}">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  ${overrides}
</Types>
`;

  const slideIds = scenes
    .map((_, i) => `      <p:sldId id="${256 + i}" r:id="rId${2 + i}"/>`)
    .join("\n");
  const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:notesMasterIdLst><p:notesMasterId r:id="rId${2 + n}"/></p:notesMasterIdLst>
  <p:sldIdLst>
${slideIds}
  </p:sldIdLst>
  <p:sldSz cx="${size.cx}" cy="${size.cy}"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>
`;

  const presentationRels = relsXml([
    { id: "rId1", type: RT.slideMaster, target: "slideMasters/slideMaster1.xml" },
    ...scenes.map((_, i) => ({ id: `rId${2 + i}`, type: RT.slide, target: `slides/slide${i + 1}.xml` })),
    { id: `rId${2 + n}`, type: RT.notesMaster, target: "notesMasters/notesMaster1.xml" },
  ]);

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(input.name)}</dc:title>
  <dc:creator>FinchLearn Studio</dc:creator>
  <cp:lastModifiedBy>FinchLearn Studio</cp:lastModifiedBy>
</cp:coreProperties>
`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>FinchLearn Studio</Application>
  <Slides>${n}</Slides>
  <Notes>${n}</Notes>
</Properties>
`;

  const entries: ZipEntryInput[] = [
    { name: "[Content_Types].xml", data: enc(contentTypes) },
    {
      name: "_rels/.rels",
      data: enc(relsXml([
        { id: "rId1", type: RT.officeDocument, target: "ppt/presentation.xml" },
        { id: "rId2", type: RT.coreProps, target: "docProps/core.xml" },
        { id: "rId3", type: RT.appProps, target: "docProps/app.xml" },
      ])),
    },
    { name: "docProps/core.xml", data: enc(core) },
    { name: "docProps/app.xml", data: enc(app) },
    { name: "ppt/presentation.xml", data: enc(presentation) },
    { name: "ppt/_rels/presentation.xml.rels", data: enc(presentationRels) },
    { name: "ppt/slideMasters/slideMaster1.xml", data: enc(SLIDE_MASTER_XML) },
    {
      name: "ppt/slideMasters/_rels/slideMaster1.xml.rels",
      data: enc(relsXml([
        { id: "rId1", type: RT.slideLayout, target: "../slideLayouts/slideLayout1.xml" },
        { id: "rId2", type: RT.theme, target: "../theme/theme1.xml" },
      ])),
    },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: enc(SLIDE_LAYOUT_XML) },
    {
      name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
      data: enc(relsXml([{ id: "rId1", type: RT.slideMaster, target: "../slideMasters/slideMaster1.xml" }])),
    },
    { name: "ppt/theme/theme1.xml", data: enc(THEME_XML) },
    { name: "ppt/notesMasters/notesMaster1.xml", data: enc(NOTES_MASTER_XML) },
    {
      name: "ppt/notesMasters/_rels/notesMaster1.xml.rels",
      data: enc(relsXml([{ id: "rId1", type: RT.theme, target: "../theme/theme1.xml" }])),
    },
  ];

  scenes.forEach((scene, i) => {
    entries.push(
      { name: `ppt/slides/slide${i + 1}.xml`, data: enc(slideXml(i, slideSizeEmu(scene.framePng))) },
      {
        name: `ppt/slides/_rels/slide${i + 1}.xml.rels`,
        data: enc(relsXml([
          { id: "rId1", type: RT.slideLayout, target: "../slideLayouts/slideLayout1.xml" },
          { id: "rId2", type: RT.image, target: `../media/image${i + 1}.png` },
          { id: "rId3", type: RT.notesSlide, target: `../notesSlides/notesSlide${i + 1}.xml` },
        ])),
      },
      { name: `ppt/media/image${i + 1}.png`, data: scene.framePng },
      {
        name: `ppt/notesSlides/notesSlide${i + 1}.xml`,
        data: enc(notesSlideXml(sceneNotesText(scene, i, n))),
      },
      {
        name: `ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`,
        data: enc(relsXml([
          { id: "rId1", type: RT.slide, target: `../slides/slide${i + 1}.xml` },
          { id: "rId2", type: RT.notesMaster, target: "../notesMasters/notesMaster1.xml" },
        ])),
      },
    );
  });

  return buildZip(entries);
}
