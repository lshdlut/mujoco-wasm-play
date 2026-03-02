# 代码清单（自动生成）

本页面由脚本自动生成，用于把代码库中的声明（文件级与嵌套）与 ESM exports 以可检索的形式列出来。

- 生成脚本：`node tools/generate_code_inventory.mjs`
- 说明：这是一个“索引/清单”，不试图解释语义；语义与流程见其它 API/Reference 页面。
- 说明：类成员提取为启发式（heuristic）——用于快速导航，不保证覆盖所有写法。
- 生成时间（UTC）：`2026-03-02T07:07:35.363Z`

## app/

### `app/main.mjs`

- 行数：1974
- 导出（Exports）：（无）
- 声明（文件级）：
  - L63: function `resolvePluginImportSpecifier`
  - L111: function `subscribeClock`
  - L120: function `formatArenaBytes`
  - L212: const => `parseTransparentBins`
  - L225: const => `parseTransparentSortMode`
  - L314: function `updateOverlay`
  - L319: function `updateRealtimeOverlay`
  - L362: function `updateToast`
  - L396: function `updateInfoOverlayTime`
  - L409: function `updateInfoOverlayFast`
  - L491: function `updateInfoOverlayCard`
  - L615: function `updatePanels`
  - L656: function `applySnapshot`
  - L750: function `scheduleUiUpdate`
  - L1025: function `deriveJointDofs`
  - L1085: function `deriveEqualityList`
  - L1377: function `assertUiPanel`
  - L1384: function `assertPluginSectionId`
  - L1396: function `uiPanelRoot`
  - L1401: function `uiPanelCoreMount`
  - L1406: function `uiPanelAfterFileMount`
  - L1410: function `createUiApi`
  - L1866: function `loadPlayPlugins`
  - L1945: function `resizeCanvas`
  - L1955: function `queueResizeCanvas`
- 声明（嵌套）：
  - L270: property => `setRenderStats`
  - L337: const => `formatPercentSpeed`
  - L343: const => `formatPercentPhysics`
  - L461: const => `solverText`
  - L479: const => `fwdinvText`
  - L498: const => `addRow`
  - L521: const => `getFieldEl`
  - L531: const => `cpuMs`
  - L754: const => `tick`
  - L998: property => `onGesture`
  - L1015: property => `getSnapshot`
  - L1196: const => `togglePanelsWithTab`
  - L1325: const => `adjustRealtime`
  - L1411: const => `panelApi`
  - L1416: property => `collapseAll`
  - L1417: property => `expandAll`
  - L1418: property => `toggleAll`
  - L1422: const => `registerSection`
  - L1533: property => `setCollapsed`
  - L1534: property => `collapse`
  - L1535: property => `expand`
  - L1536: property => `toggle`
  - L1537: property => `dispose`
  - L1562: property => `namedRow`
  - L1575: property => `fullRow`
  - L1584: property => `button`
  - L1597: property => `textbox`
  - L1634: property => `select`
  - L1681: property => `range`
  - L1697: property => `segmented`
  - L1741: property => `value`
  - L1745: property => `setValue`
  - L1754: property => `codebox`
  - L1761: property => `boolButton`
  - L1793: property => `unregister`
  - L1800: property => `get`
  - L1801: property => `list`
  - L1810: property => `getBinding`
  - L1811: property => `listIds`
  - L1812: property => `toggleControl`
  - L1813: property => `getControl`
  - L1814: property => `loadXmlTextAsModel`
  - L1817: property => `getStats`
  - L1818: property => `getContext`
  - L1819: property => `ensureLoop`
  - L1820: property => `renderScene`
  - L1821: property => `getOverlay3D`
  - L1823: property => `get`
  - L1824: property => `createScope`
  - L1828: property => `getScope`
  - L1848: property => `getSnapshot`
  - L1851: property => `onUiTick`
  - L1852: property => `onUiMainTick`
  - L1854: property => `onUiControlsTick`
  - L1855: property => `onUiSlowTick`
  - L1856: property => `onSnapshot`
  - L1857: property => `onFrame`
- 类成员（启发式）：（无）

### `app/play_host.mjs`

- 行数：66
- 导出（Exports）：
  - L15: export function `createPlayHost`
- 声明（文件级）：
  - L5: function `freezeIfObject`
  - L15: function `createPlayHost`
- 声明（嵌套）：
  - L46: property => `getCapability`
- 类成员（启发式）：（无）

## core/

### `core/fallbacks.mjs`

- 行数：27
- 导出（Exports）：
  - L13: export function `compatFallback`
- 声明（文件级）：
  - L13: function `compatFallback`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `core/viewer_defaults.mjs`

- 行数：33
- 导出（Exports）：
  - L15: export const `MJ_GROUP_TYPES`
  - L16: export const `MJ_GROUP_COUNT`
  - L18: export const `SCENE_FLAG_DEFAULTS`
  - L20: export const `DEFAULT_VOPT_FLAGS`
  - L22: export const `SCENE_FLAG_DEFAULTS_NUMERIC`
  - L25: export const `DEFAULT_VOPT_FLAGS_NUMERIC`
  - L29: export const `REALTIME_LEVELS`
  - L31: export const `DEFAULT_REALTIME_INDEX`
- 声明（文件级）：
  - L5: function `makeFlagArray`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `core/viewer_runtime.mjs`

- 行数：567
- 导出（Exports）：
  - L4: export function `isVerboseDebug`
  - L31: export function `logStatus`
  - L43: export function `logWarn`
  - L51: export function `logError`
  - L59: export function `logDebug`
  - L75: export function `isPerfEnabled`
  - L81: export function `perfNow`
  - L102: export function `perfMark`
  - L116: export function `perfMarkOnce`
  - L124: export function `perfSample`
  - L142: export function `perfClearSamples`
  - L190: export function `perfSummary`
  - L249: export function `getParamToken`
  - L254: export function `readBoolean`
  - L265: export function `readTruthyFlag`
  - L269: export function `readListParam`
  - L278: export function `readIndexSet`
  - L285: export function `readNumericParam`
  - L300: export function `consumeViewerParams`
  - L328: export `viewerSearchParams`
  - L330: export function `buildWorkerUrl`
  - L348: export function `normalizeVer`
  - L353: export function `getForgeDistBase`
  - L381: export function `getVersionInfo`
  - L394: export function `withCacheTag`
  - L416: export function `isStrictEnabled`
  - L427: export function `isCompatEnabled`
  - L495: export function `strictFallback`
  - L504: export function `strictOverride`
  - L515: export function `strictEnsure`
  - L524: export function `strictCatch`
  - L534: export function `getStrictReport`
  - L546: export function `clearStrictReport`
- 声明（文件级）：
  - L4: function `isVerboseDebug`
  - L23: function `isWorkerContext`
  - L27: function `postWorkerLog`
  - L31: function `logStatus`
  - L43: function `logWarn`
  - L51: function `logError`
  - L59: function `logDebug`
  - L75: function `isPerfEnabled`
  - L81: function `perfNow`
  - L86: function `ensurePerfState`
  - L102: function `perfMark`
  - L116: function `perfMarkOnce`
  - L124: function `perfSample`
  - L142: function `perfClearSamples`
  - L151: function `quantile`
  - L162: function `summarizeValues`
  - L182: function `phaseMs`
  - L190: function `perfSummary`
  - L234: const => `viewerSearchParams`
  - L247: const => `normaliseKey`
  - L249: function `getParamToken`
  - L254: function `readBoolean`
  - L265: function `readTruthyFlag`
  - L269: function `readListParam`
  - L278: function `readIndexSet`
  - L285: function `readNumericParam`
  - L300: function `consumeViewerParams`
  - L330: function `buildWorkerUrl`
  - L348: function `normalizeVer`
  - L353: function `getForgeDistBase`
  - L368: function `resolveForgeDistBaseOverride`
  - L381: function `getVersionInfo`
  - L394: function `withCacheTag`
  - L409: function `resolveStrictFlag`
  - L416: function `isStrictEnabled`
  - L420: function `resolveCompatFlag`
  - L427: function `isCompatEnabled`
  - L431: function `ensureStrictState`
  - L461: function `recordStrictEvent`
  - L495: function `strictFallback`
  - L504: function `strictOverride`
  - L515: function `strictEnsure`
  - L524: function `strictCatch`
  - L534: function `getStrictReport`
  - L546: function `clearStrictReport`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `core/viewer_shared.mjs`

- 行数：151
- 导出（Exports）：
  - L6: export function `toNumber`
  - L12: export function `bool`
  - L22: export function `cloneStruct`
  - L39: export function `resolveStructPath`
  - L58: export function `assignStructPath`
  - L87: export function `createDefaultHistoryState`
  - L98: export function `createDefaultWatchState`
  - L113: export function `createDefaultKeyframeState`
  - L124: export function `createViewerGroupState`
  - L132: export function `normaliseGroupState`
  - L144: export function `splitBinding`
- 声明（文件级）：
  - L6: function `toNumber`
  - L12: function `bool`
  - L22: function `cloneStruct`
  - L39: function `resolveStructPath`
  - L58: function `assignStructPath`
  - L87: function `createDefaultHistoryState`
  - L98: function `createDefaultWatchState`
  - L113: function `createDefaultKeyframeState`
  - L124: function `createViewerGroupState`
  - L132: function `normaliseGroupState`
  - L144: function `splitBinding`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `core/viewer_state_types.ts`

- 行数：389
- 导出（Exports）：
  - L378: export `DEFAULT_VIEWER_STATE`
  - L378: export `createViewerStore`
  - L378: export `applySpecAction`
  - L378: export `applyGesture`
  - L378: export `createBackend`
  - L378: export `readControlValue`
  - L378: export `cameraLabelFromIndex`
  - L378: export `mergeBackendSnapshot`
  - L378: export `switchVisualSourceMode`
  - L378: export `} from './state.mjs'`
- 声明（文件级）：（未发现）
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `core/viewer_structs.mjs`

- 行数：1030
- 导出（Exports）：
  - L109: export function `setStructPath`
  - L148: export function `writeStructField`
  - L185: export function `readStructSnapshot`
  - L215: export const `OPTION_LAYOUT`
  - L414: export function `writeOptionField`
  - L434: export function `readOptionStruct`
  - L465: export function `detectOptionSupport`
  - L476: export const `VISUAL_FIELD_DESCRIPTORS`
  - L983: export function `writeVisualField`
  - L987: export function `readVisualStruct`
  - L991: export const `STAT_FIELD_DESCRIPTORS`
  - L1022: export function `writeStatisticField`
  - L1026: export function `readStatisticStruct`
- 声明（文件级）：
  - L6: function `pointerName`
  - L13: function `getFieldPtr`
  - L26: function `resolveHeapBuffer`
  - L54: function `writeTyped`
  - L80: function `readTyped`
  - L96: function `toArrayValue`
  - L109: function `setStructPath`
  - L138: function `selectArrayConfig`
  - L148: function `writeStructField`
  - L176: function `normaliseReadValue`
  - L185: function `readStructSnapshot`
  - L361: function `resolveOptionHeapBuffer`
  - L365: function `getOptionFieldPtr`
  - L379: function `writeArray`
  - L399: function `readArray`
  - L414: function `writeOptionField`
  - L434: function `readOptionStruct`
  - L465: function `detectOptionSupport`
  - L983: function `writeVisualField`
  - L987: function `readVisualStruct`
  - L1022: function `writeStatisticField`
  - L1026: function `readStatisticStruct`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `core/xml_refs.mjs`

- 行数：457
- 导出（Exports）：
  - L89: export function `parseMuJoCoDirectFileRefs`
  - L146: export function `normaliseMuJoCoVirtualPath`
  - L152: export function `joinMuJoCoRelativePath`
  - L179: export function `buildMuJoCoBundle`
- 声明（文件级）：
  - L6: function `normaliseSlashes`
  - L10: function `trimTrailingSlash`
  - L15: function `normalisePosixPath`
  - L37: function `parseXmlOrThrow`
  - L50: function `readCompilerDirs`
  - L73: function `isInlineDataPath`
  - L78: function `isRemotePath`
  - L83: function `shouldTreatAsAbsolutePath`
  - L89: function `parseMuJoCoDirectFileRefs`
  - L146: function `normaliseMuJoCoVirtualPath`
  - L152: function `joinMuJoCoRelativePath`
  - L160: function `decodeTextFromArrayBuffer`
  - L168: function `dirnamePosix`
  - L175: function `isOutsideRoot`
  - L179: function `buildMuJoCoBundle`
- 声明（嵌套）：
  - L52: const => `read`
  - L57: const => `readBool`
  - L94: const => `addRef`
  - L199: function `basenamePosix`
  - L206: function `ensureFileBufferForCandidates`
  - L236: function `resolveCompilerDir`
  - L258: function `resolveCompilerState`
  - L293: function `resolveRefCandidates`
  - L312: const => `primaryBase`
  - L415: const => `formatSample`
- 类成员（启发式）：（无）

## environment/

### `environment/environment.mjs`

- 行数：1326
- 导出（Exports）：
  - L1320: export `FALLBACK_PRESETS`
  - L1320: export `FALLBACK_PRESET_ALIASES`
  - L1320: export `createEnvironmentManager`
  - L1320: export `pushSkyDebug`
- 声明（文件级）：
  - L12: function `clamp01`
  - L19: function `getWorldScene`
  - L133: function `ensureSkyCache`
  - L147: function `hasModelEnvironment`
  - L155: function `hasModelLights`
  - L160: function `hasModelBackground`
  - L166: function `pushSkyDebug`
  - L179: function `detachEnvironment`
  - L192: function `ensureModelGradientEnv`
  - L242: function `readSkyboxTextureFromAssets`
  - L324: function `createCubeTextureFromSkybox`
  - L395: function `ensureModelSkyFromAssets`
  - L561: function `disposeEnvResources`
  - L582: function `createVerticalGradientTexture`
  - L611: function `colorL1`
  - L618: function `computeRowVariance`
  - L650: function `sampleFaceBand`
  - L679: function `extractMjSkyPalette`
  - L706: function `classifySkyboxTexture`
  - L748: function `createSkyShaderMaterial`
  - L826: function `ensureSkyDome`
  - L842: function `updateSkyDome`
  - L881: function `buildSkyBackground`
  - L887: function `createEnvironmentManager`
- 声明（嵌套）：
  - L688: const => `toColor`
  - L893: function `syncRendererClearColor`
  - L903: function `ensureOutdoorSkyEnv`
  - L973: const => `tryLoadHDRI`
  - L1142: function `applyFallbackAppearance`
  - L1210: function `ensureEnvIfNeeded`
- 类成员（启发式）：（无）

## backend/

### `backend/backend_core.mjs`

- 行数：1783
- 导出（Exports）：
  - L18: export function `createBackend`
- 声明（文件级）：
  - L18: function `createBackend`
- 声明（嵌套）：
  - L39: const => `normaliseInt`
  - L43: const => `sampleIfFinite`
  - L77: function `resetAdaptiveSnapshotState`
  - L86: function `ewma`
  - L92: function `postSnapshotHzIfChanged`
  - L109: function `maybeUpdateAdaptiveSnapshotHz`
  - L170: function `applySimulateMaskBinding`
  - L203: function `spawnWorkerBackend`
  - L208: function `collectLoadTransfers`
  - L222: function `requestWorkerStrictReport`
  - L238: function `loadDefaultXml`
  - L299: function `notifyListeners`
  - L331: function `detachClient`
  - L338: function `restartWorkerWithLoadPayload`
  - L390: function `restartWorkerWithXml`
  - L395: function `formatCopyNumber`
  - L404: function `buildCopyKeyXmlFromPayload`
  - L431: const => `format`
  - L456: function `writeCopyKeyToClipboard`
  - L471: function `applyOptionSnapshot`
  - L504: function `setRunState`
  - L517: function `setRate`
  - L529: function `loadXmlText`
  - L535: function `loadXmlBundle`
  - L544: function `applyVisualStatePayload`
  - L581: function `updateGeometryCaches`
  - L582: const => `makeView`
  - L596: const => `makeViewOrNull`
  - L610: property => `strict_report`
  - L618: property => `run_state`
  - L625: property => `ready`
  - L715: property => `latency_probe`
  - L727: property => `struct_state`
  - L737: property => `meta_cameras`
  - L747: property => `meta_geoms`
  - L751: property => `selection`
  - L768: property => `meta_joints`
  - L769: const => `toI32`
  - L796: const => `jrange`
  - L814: property => `meta`
  - L832: property => `snapshot`
  - L1067: property => `keyframes`
  - L1071: property => `history`
  - L1075: property => `watch`
  - L1083: property => `render_assets`
  - L1106: property => `gesture`
  - L1122: property => `align`
  - L1137: property => `copyState`
  - L1164: property => `options`
  - L1168: property => `log`
  - L1171: property => `error`
  - L1183: function `handleMessage`
  - L1368: property => `handle`
  - L1387: property => `handle`
  - L1404: property => `handle`
  - L1419: property => `handle`
  - L1434: function `dispatchBinding`
  - L1459: function `apply`
  - L1594: function `snapshot`
  - L1598: function `subscribe`
  - L1604: function `step`
  - L1647: function `setCameraIndex`
  - L1651: const => `toVec3`
  - L1662: function `applyPerturbCommand`
  - L1715: function `setSelectionCommand`
  - L1730: function `selectAtCommand`
  - L1749: function `dispose`
  - L1771: property => `getStrictReport`
  - L1775: property => `getInitialModelInfo`
  - L1776: property => `getBuiltinModels`
- 类成员（启发式）：（无）

### `backend/model_candidates.mjs`

- 行数：50
- 导出（Exports）：
  - L13: export const `MODEL_POOL`
  - L21: export function `resolveModelFileName`
  - L34: export function `buildModelCandidates`
- 声明（文件级）：
  - L21: function `resolveModelFileName`
  - L34: function `buildModelCandidates`
- 声明（嵌套）：
  - L37: const => `pushCandidate`
- 类成员（启发式）：（无）

### `backend/snapshot_utils.mjs`

- 行数：350
- 导出（Exports）：
  - L19: export function `applyViewFields`
  - L30: export function `applyHistoryPayload`
  - L41: export function `applyKeyframesPayload`
  - L75: export function `applyWatchPayload`
  - L109: export function `createInitialSnapshot`
  - L156: export function `resolveSnapshot`
- 声明（文件级）：
  - L19: function `applyViewFields`
  - L30: function `applyHistoryPayload`
  - L41: function `applyKeyframesPayload`
  - L75: function `applyWatchPayload`
  - L109: function `createInitialSnapshot`
  - L156: function `resolveSnapshot`
- 声明（嵌套）：
  - L157: const => `viewOrNull`
  - L221: property => `sceneFlags`
- 类成员（启发式）：（无）

## bridge/

### `bridge/heap_views.mjs`

- 行数：167
- 导出（Exports）：
  - L5: export function `resolveHeapBuffer`
  - L111: export function `computeMeshElementCounts`
  - L142: export function `heapViewF64`
  - L145: export function `heapViewF32`
  - L148: export function `heapViewI32`
  - L151: export function `heapViewU8`
  - L154: export function `readCString`
- 声明（文件级）：
  - L5: function `resolveHeapBuffer`
  - L40: function `ensureHeapViewCache`
  - L56: function `createHeapTypedArray`
  - L111: function `computeMeshElementCounts`
  - L142: function `heapViewF64`
  - L145: function `heapViewF32`
  - L148: function `heapViewI32`
  - L151: function `heapViewU8`
  - L154: function `readCString`
- 声明（嵌套）：
  - L121: const => `safeMax`
- 类成员（启发式）：（无）

### `bridge/mj_sim_lite.mjs`

- 行数：1247
- 导出（Exports）：
  - L22: export class `MjSimLite`
- 声明（文件级）：
  - L7: function `tagForgeModule`
  - L22: class `MjSimLite`
- 声明（嵌套）：
  - L309: const => `call`
  - L643: property => `release`
  - L703: const => `readScalar`
- 类成员（启发式）：
  - L23: method `MjSimLite#constructor`
  - L46: method `MjSimLite#strictCatch`
  - L51: method (async) `MjSimLite#maybeInstallShimFromQuery`
  - L56: method `MjSimLite#_cstr`
  - L60: method `MjSimLite#_mkdirTree`
  - L76: method `MjSimLite#strictCatch`
  - L101: method `MjSimLite#_tryHelperMakeFromXml`
  - L169: method `MjSimLite#_validateHandleOrThrow`
  - L191: method `MjSimLite#initFromXmlStrict`
  - L228: method `MjSimLite#strictCatch`
  - L257: method `MjSimLite#logError`
  - L266: method `MjSimLite#_invalidateCaches`
  - L278: method `MjSimLite#strictCatch`
  - L282: method `MjSimLite#_ensurePtrCache`
  - L293: method `MjSimLite#_cachedPtr`
  - L304: method `MjSimLite#_ensureCountCache`
  - L340: method `MjSimLite#ensurePointers`
  - L362: method `MjSimLite#nq`
  - L363: method `MjSimLite#nv`
  - L364: method `MjSimLite#nu`
  - L365: method `MjSimLite#njnt`
  - L366: method `MjSimLite#ncam`
  - L367: method `MjSimLite#nlight`
  - L368: method `MjSimLite#nsite`
  - L369: method `MjSimLite#nflex`
  - L370: method `MjSimLite#nflexvert`
  - L371: method `MjSimLite#ntendon`
  - L372: method `MjSimLite#nwrap`
  - L373: method `MjSimLite#nsensor`
  - L374: method `MjSimLite#nsensordata`
  - L375: method `MjSimLite#neq`
  - L378: method `MjSimLite#qposView`
  - L383: method `MjSimLite#qvelView`
  - L388: method `MjSimLite#ctrlView`
  - L393: method `MjSimLite#actuatorCtrlRangeView`
  - L394: method `MjSimLite#jntQposAdrView`
  - L395: method `MjSimLite#jntRangeView`
  - L396: method `MjSimLite#jntTypeView`
  - L397: method `MjSimLite#jntNameOf`
  - L400: method `MjSimLite#jntPosView`
  - L401: method `MjSimLite#jntAxisView`
  - L402: method `MjSimLite#jntBodyIdView`
  - L403: method `MjSimLite#actuatorTrnidView`
  - L404: method `MjSimLite#actuatorTrntypeView`
  - L405: method `MjSimLite#actuatorCranklengthView`
  - L406: method `MjSimLite#siteXposView`
  - L407: method `MjSimLite#siteXmatView`
  - L408: method `MjSimLite#tenWrapAdrView`
  - L409: method `MjSimLite#tenWrapNumView`
  - L410: method `MjSimLite#wrapObjView`
  - L411: method `MjSimLite#wrapXposView`
  - L412: method `MjSimLite#flexvertXposView`
  - L413: method `MjSimLite#sensorTypeView`
  - L414: method `MjSimLite#sensorObjIdView`
  - L415: method `MjSimLite#eqTypeView`
  - L416: method `MjSimLite#eqObj1IdView`
  - L417: method `MjSimLite#eqObj2IdView`
  - L418: method `MjSimLite#eqObjTypeView`
  - L419: method `MjSimLite#eqDataView`
  - L420: method `MjSimLite#eqActiveView`
  - L421: method `MjSimLite#eqActive0View`
  - L422: method `MjSimLite#id2name`
  - L423: method `MjSimLite#camXposView`
  - L424: method `MjSimLite#camXmatView`
  - L425: method `MjSimLite#lightXposView`
  - L426: method `MjSimLite#lightXdirView`
  - L427: method `MjSimLite#stateSize`
  - L435: method `MjSimLite#captureState`
  - L454: method `MjSimLite#applyState`
  - L478: method `MjSimLite#nkey`
  - L482: method `MjSimLite#setKeyframe`
  - L491: method `MjSimLite#resetKeyframe`
  - L502: method `MjSimLite#forward`
  - L511: method `MjSimLite#setQpos`
  - L512: method `MjSimLite#setCtrl`
  - L524: method `MjSimLite#step`
  - L540: method `MjSimLite#timestep`
  - L549: method `MjSimLite#time`
  - L559: method `MjSimLite#_readPtr`
  - L564: method `MjSimLite#_readModelPtr`
  - L565: method `MjSimLite#_readDataPtr`
  - L567: method `MjSimLite#_withStack`
  - L600: method `MjSimLite#_ensureContactForceScratch`
  - L612: method `MjSimLite#_acquireContactForceScratch`
  - L651: method `MjSimLite#_freeContactForceScratch`
  - L661: method `MjSimLite#_nameFromAdr`
  - L680: method `MjSimLite#pointerDiagnostics`
  - L699: method `MjSimLite#strictCatch`
  - L715: method `MjSimLite#ngeom`
  - L716: method `MjSimLite#nbody`
  - L717: method `MjSimLite#bodyJntAdrView`
  - L718: method `MjSimLite#bodyJntNumView`
  - L719: method `MjSimLite#bodyParentIdView`
  - L721: method `MjSimLite#geomXposView`
  - L722: method `MjSimLite#geomXmatView`
  - L723: method `MjSimLite#bodyXposView`
  - L724: method `MjSimLite#bodyXmatView`
  - L725: method `MjSimLite#bodyXiposView`
  - L733: method `MjSimLite#bodyXimatView`
  - L741: method `MjSimLite#xanchorView`
  - L749: method `MjSimLite#dofIslandView`
  - L757: method `MjSimLite#nisland`
  - L763: method `MjSimLite#nbvh`
  - L767: method `MjSimLite#nbvhdynamic`
  - L771: method `MjSimLite#bvhActiveView`
  - L779: method `MjSimLite#bvhAabbDynView`
  - L787: method `MjSimLite#bodyCvelView`
  - L788: method `MjSimLite#bodyXquatView`
  - L796: method `MjSimLite#quat2Vel`
  - L819: method `MjSimLite#strictCatch`
  - L831: method `MjSimLite#bodyInertiaScalar`
  - L853: method `MjSimLite#bodyWorldVelocity`
  - L862: method `MjSimLite#strictCatch`
  - L879: method `MjSimLite#strictCatch`
  - L889: method `MjSimLite#bodyLocalMassAtPoint`
  - L900: method `MjSimLite#strictCatch`
  - L943: method `MjSimLite#strictCatch`
  - L965: method `MjSimLite#geomSizeView`
  - L966: method `MjSimLite#geomTypeView`
  - L967: method `MjSimLite#geomMatIdView`
  - L968: method `MjSimLite#geomDataidView`
  - L969: method `MjSimLite#geomBodyIdView`
  - L971: method `MjSimLite#sceneUpdateAndPack`
  - L972: method `MjSimLite#sceneNgeom`
  - L973: method `MjSimLite#sceneGeomOrderView`
  - L974: method `MjSimLite#sceneGeomCamDistView`
  - L975: method `MjSimLite#sceneGeomTypeView`
  - L976: method `MjSimLite#sceneGeomPosView`
  - L977: method `MjSimLite#sceneGeomMatView`
  - L978: method `MjSimLite#sceneGeomSizeView`
  - L979: method `MjSimLite#sceneGeomRgbaView`
  - L980: method `MjSimLite#sceneGeomMatIdView`
  - L981: method `MjSimLite#sceneGeomDataIdView`
  - L982: method `MjSimLite#sceneGeomObjTypeView`
  - L983: method `MjSimLite#sceneGeomObjIdView`
  - L984: method `MjSimLite#sceneGeomCategoryView`
  - L985: method `MjSimLite#sceneGeomSegIdView`
  - L986: method `MjSimLite#sceneGeomTransparentView`
  - L987: method `MjSimLite#sceneGeomLabelView`
  - L989: method `MjSimLite#voptFlagsPtrView`
  - L990: method `MjSimLite#voptLabelPtrView`
  - L991: method `MjSimLite#voptFramePtrView`
  - L992: method `MjSimLite#voptFlexLayerPtrView`
  - L993: method `MjSimLite#voptBvhDepthPtrView`
  - L994: method `MjSimLite#voptGeomGroupView`
  - L995: method `MjSimLite#voptSiteGroupView`
  - L996: method `MjSimLite#voptTendonGroupView`
  - L997: method `MjSimLite#voptJointGroupView`
  - L998: method `MjSimLite#voptActuatorGroupView`
  - L999: method `MjSimLite#voptFlexGroupView`
  - L1000: method `MjSimLite#voptSkinGroupView`
  - L1003: method `MjSimLite#scenePtr`
  - L1004: method `MjSimLite#camTypePtrView`
  - L1005: method `MjSimLite#camLookatPtrView`
  - L1006: method `MjSimLite#camDistancePtrView`
  - L1007: method `MjSimLite#camAzimuthPtrView`
  - L1008: method `MjSimLite#camElevationPtrView`
  - L1009: method `MjSimLite#camOrthographicPtrView`
  - L1010: method `MjSimLite#camFixedcamidPtrView`
  - L1011: method `MjSimLite#camTrackbodyidPtrView`
  - L1013: method `MjSimLite#pertPtr`
  - L1014: method `MjSimLite#pertSelectPtrView`
  - L1015: method `MjSimLite#pertActivePtrView`
  - L1016: method `MjSimLite#pertActive2PtrView`
  - L1017: method `MjSimLite#pertLocalposPtrView`
  - L1018: method `MjSimLite#pertScalePtrView`
  - L1019: method `MjSimLite#pertFlexselectPtrView`
  - L1020: method `MjSimLite#pertSkinselectPtrView`
  - L1021: method `MjSimLite#nmat`
  - L1022: method `MjSimLite#matRgbaView`
  - L1023: method `MjSimLite#nmesh`
  - L1024: method `MjSimLite#meshVertAdrView`
  - L1025: method `MjSimLite#meshVertNumView`
  - L1026: method `MjSimLite#meshFaceAdrView`
  - L1027: method `MjSimLite#meshFaceNumView`
  - L1028: method `MjSimLite#meshVertView`
  - L1047: method `MjSimLite#meshNormalView`
  - L1066: method `MjSimLite#meshFaceView`
  - L1085: method `MjSimLite#meshTexcoordView`
  - L1104: method `MjSimLite#meshTexcoordAdrView`
  - L1105: method `MjSimLite#meshTexcoordNumView`
  - L1106: method `MjSimLite#collectRenderAssets`
  - L1111: method `MjSimLite#ncon`
  - L1112: method `MjSimLite#_contactFieldView`
  - L1134: method `MjSimLite#contactPosView`
  - L1135: method `MjSimLite#contactFrameView`
  - L1136: method `MjSimLite#contactGeom1View`
  - L1137: method `MjSimLite#contactGeom2View`
  - L1138: method `MjSimLite#contactDistView`
  - L1139: method `MjSimLite#contactFrictionView`
  - L1140: method `MjSimLite#contactForceBuffer`
  - L1166: method `MjSimLite#actuatorNameOf`
  - L1170: method `MjSimLite#cameraNameOf`
  - L1173: method `MjSimLite#geomNameOf`
  - L1178: method `MjSimLite#applyXfrcByGeom`
  - L1200: method `MjSimLite#applyXfrcByBody`
  - L1217: method `MjSimLite#clearAllXfrc`
  - L1218: method `MjSimLite#reset`
  - L1229: method `MjSimLite#term`

### `bridge/render_assets_collect.mjs`

- 行数：746
- 导出（Exports）：
  - L33: export function `collectRenderAssetsFromModule`
- 声明（文件级）：
  - L6: function `cloneTyped`
  - L27: function `readView`
  - L33: function `collectRenderAssetsFromModule`
- 声明（嵌套）：
  - L52: const => `ensureFunc`
- 类成员（启发式）：（无）

## renderer/

### `renderer/controllers.mjs`

- 行数：957
- 导出（Exports）：
  - L953: export `createCameraController`
  - L953: export `createPickingController`
- 声明（文件级）：
  - L10: function `createCameraController`
  - L424: function `defaultSelection`
  - L447: function `createPickingController`
- 声明（嵌套）：
  - L60: const => `cameraModeIndex`
  - L69: const => `isInteractiveCamera`
  - L71: function `currentCtrl`
  - L75: function `currentShift`
  - L79: function `resolveGestureMode`
  - L86: function `pointerButtons`
  - L103: function `computeMinDistance`
  - L114: function `computeWheelReldy`
  - L119: function `buildCameraPayloadIfNeeded`
  - L145: function `applyCameraGesture`
  - L249: function `handlePointerDown`
  - L276: function `handlePointerMove`
  - L305: function `handlePointerUp`
  - L329: function `handleWheel`
  - L359: function `handleKey`
  - L369: function `install`
  - L374: const => `onPointerDown`
  - L375: const => `onPointerMove`
  - L376: const => `onPointerUp`
  - L377: const => `onWheel`
  - L378: const => `onContextMenu`
  - L381: const => `onKeyDown`
  - L382: const => `onKeyUp`
  - L407: function `dispose`
  - L419: property => `getModifierState`
  - L484: function `hasSelection`
  - L489: function `currentSelection`
  - L493: function `selectionSeq`
  - L497: function `clearSelection`
  - L511: function `showToast`
  - L519: function `updateSelection`
  - L555: function `getMeshList`
  - L575: function `projectPointer`
  - L584: function `resolveGeomMesh`
  - L595: function `geomNameFor`
  - L605: function `bodyIdFor`
  - L616: function `jointIdFor`
  - L631: function `applySelectionFromPick`
  - L651: function `resolveDragMode`
  - L657: function `selectionAsBody`
  - L663: function `updateAnchorFromSelection`
  - L680: function `setAnchorLocalFromWorld`
  - L716: function `resolvePick`
  - L762: function `selectionFromPick`
  - L770: function `beginPerturb`
  - L789: function `movePerturb`
  - L808: function `endPerturb`
  - L818: function `onClick`
  - L823: function `onDoubleClick`
  - L842: function `onPointerMove`
  - L847: function `onPointerDragStart`
  - L867: function `onPointerDragEnd`
  - L880: function `install`
  - L881: const => `onPointerDownEvt`
  - L890: const => `onPointerUpEvt`
  - L897: const => `onPointerMoveEvt`
  - L904: const => `onContextMenu`
  - L930: function `dispose`
- 类成员（启发式）：（无）

### `renderer/deformables.mjs`

- 行数：998
- 导出（Exports）：
  - L986: export `ensureFlexGroup`
  - L986: export `hideFlexGroup`
  - L986: export `ensureFlexEntry`
  - L986: export `applyFlexAppearance`
  - L986: export `updateFlexFaces`
  - L986: export `ensureSkinGroup`
  - L986: export `hideSkinGroup`
  - L986: export `ensureSkinEntry`
  - L986: export `applySkinAppearance`
  - L986: export `updateSkinMesh`
- 声明（文件级）：
  - L9: function `clampUnit`
  - L15: function `applyAppearanceToMaterial`
  - L48: function `resolveIndexedRgbaAppearance`
  - L74: function `resolveFlexAppearance`
  - L78: function `resolveSkinAppearance`
  - L82: function `ensureFlexGroup`
  - L95: function `hideFlexGroup`
  - L106: function `ensureFlexEntry`
  - L216: function `applyFlexAppearance`
  - L231: function `normalize3Inv`
  - L237: function `flexMakeFace`
  - L266: function `flexAddNormal`
  - L282: function `flexMakeSmooth`
  - L320: function `flexMakeSide`
  - L349: function `fillFlexFaceTexcoords`
  - L374: function `updateFlexFaces`
  - L687: function `ensureSkinGroup`
  - L700: function `hideSkinGroup`
  - L711: function `ensureSkinEntry`
  - L804: function `applySkinAppearance`
  - L815: function `quatToMat3`
  - L840: function `updateSkinMesh`
- 声明（嵌套）：
  - L352: const => `writeUV`
  - L382: const => `ensureAttribute`
- 类成员（启发式）：（无）

### `renderer/depth_sort.mjs`

- 行数：39
- 导出（Exports）：
  - L33: export `depthFromSoAPos`
  - L33: export `transparentBinFromDepthNorm`
  - L33: export `transparentDepthNorm01`
- 声明（文件级）：
  - L3: function `depthFromSoAPos`
  - L21: function `transparentDepthNorm01`
  - L26: function `transparentBinFromDepthNorm`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `renderer/geom_names.mjs`

- 行数：31
- 导出（Exports）：
  - L15: export function `getOrCreateGeomNameLookup`
  - L27: export function `geomNameFromLookup`
- 声明（文件级）：
  - L3: function `createGeomNameLookup`
  - L15: function `getOrCreateGeomNameLookup`
  - L27: function `geomNameFromLookup`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `renderer/mujoco_constants.mjs`

- 行数：110
- 导出（Exports）：
  - L3: export const `MJ_GEOM`
  - L26: export const `MJ_VIS`
  - L60: export const `MJ_OBJ`
  - L92: export const `MJ_LIGHT_TYPE`
  - L99: export const `MJ_MAXLIGHT`
  - L103: export const `MJ_MAXPLANEGRID`
  - L105: export const `MJ_MINVAL`
  - L106: export const `MJ_TEXTURE`
- 声明（文件级）：（未发现）
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `renderer/mujoco_shadows.mjs`

- 行数：75
- 导出（Exports）：
  - L25: export function `installMuJoCoShadowViewportInset`
  - L64: export function `onBeforeShadowMuJoCo`
- 声明（文件级）：
  - L25: function `installMuJoCoShadowViewportInset`
  - L64: function `onBeforeShadowMuJoCo`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `renderer/mujoco_textures.mjs`

- 行数：650
- 导出（Exports）：
  - L644: export `resolveMaterialTextureDescriptor`
  - L644: export `quantize1e6`
  - L644: export `quantize1e3`
  - L644: export `applyMuJoCoTextureToMesh`
- 声明（文件级）：
  - L7: function `resolveMaterialTextureDescriptor`
  - L53: function `getMuJoCoTextureCache`
  - L60: function `createMuJoCoDataTexture`
  - L129: function `applyMuJoCoTextureColorspace`
  - L140: function `createMuJoCoCubeTexture`
  - L180: function `getOrCreateMuJoCoTexture`
  - L233: function `getOrCreateMuJoCoCubeTexture`
  - L268: function `resolveMuJoCoTextureType`
  - L275: function `quantize1e6`
  - L281: function `quantize1e3`
  - L287: function `resolveMuJoCoTexcoordScale3`
  - L314: function `ensureMuJoCo2DGeneratedTexcoords`
  - L430: function `ensureMuJoCoCubeAlbedoHooks`
  - L471: function `applyMuJoCoCubeAlbedo`
  - L492: function `applyMuJoCoTextureToMesh`
- 声明（嵌套）：
  - L107: const => `isPow2`
- 类成员（启发式）：（无）

### `renderer/overlay3d.mjs`

- 行数：1117
- 导出（Exports）：
  - L1113: export `disposeOverlay3D`
  - L1113: export `ensureOverlay3D`
- 声明（文件级）：
  - L13: class `RefCountedAssetRegistry`
  - L87: function `ensureOverlay3D`
  - L1100: function `disposeOverlay3D`
- 声明（嵌套）：
  - L37: const => `release`
  - L189: property => `acquire`
  - L194: property => `geometryPrimitive`
  - L219: property => `texture2DFromUrl`
  - L246: const => `addObject3D`
  - L329: const => `resolveTransparency`
  - L382: const => `wantsFrameSort`
  - L387: const => `updateFrameRegistration`
  - L418: const => `updateBoundingSphere`
  - L466: const => `syncToGpu`
  - L651: const => `flushCommit`
  - L670: const => `commit`
  - L676: const => `onFrame`
  - L684: const => `setTransparency`
  - L718: const => `dispose`
  - L795: const => `flushCommit`
  - L810: const => `commit`
  - L817: const => `dispose`
  - L876: const => `flushCommit`
  - L891: const => `commit`
  - L898: const => `dispose`
  - L946: const => `dispose`
  - L978: property => `dispose`
- 类成员（启发式）：
  - L14: method `RefCountedAssetRegistry#constructor`
  - L20: method `RefCountedAssetRegistry#acquire`
  - L49: method `RefCountedAssetRegistry#strictCatch`
  - L63: method `RefCountedAssetRegistry#disposeAll`
  - L70: method `RefCountedAssetRegistry#strictCatch`
  - L77: method `RefCountedAssetRegistry#stats`

### `renderer/pipeline.mjs`

- 行数：3686
- 导出（Exports）：
  - L363: export function `resolveTrackingBodyId`
  - L380: export function `buildViewerCameraPayload`
  - L1114: export function `normalizeDeltaByViewportHeight`
  - L3683: export `createRendererManager`
- 声明（文件级）：
  - L94: function `mjuRound`
  - L106: function `applySkyboxVisibility`
  - L168: function `setQuatFromMat3`
  - L203: function `computeGeomRadius`
  - L225: function `clampUnit`
  - L232: function `parseVectorLike`
  - L253: function `rgbFromArray`
  - L265: function `computeSceneExtent`
  - L273: function `resolveFogConfig`
  - L307: function `resolveHazeConfig`
  - L331: function `applySceneFog`
  - L351: function `ensureCameraTarget`
  - L363: function `resolveTrackingBodyId`
  - L380: function `buildViewerCameraPayload`
  - L410: function `sendViewerCameraSync`
  - L429: function `ensureFreeCameraPose`
  - L445: function `cacheTrackingPoseFromCurrent`
  - L460: function `rememberFreeCameraPose`
  - L472: function `restoreFreeCameraPose`
  - L488: function `applyTrackingCamera`
  - L573: function `ensureMjLightRig`
  - L597: function `removeMjLightSlot`
  - L603: function `createMjLightSlot`
  - L630: function `ensureMjLightSlot`
  - L642: function `disableMjLightSlot`
  - L649: function `updateMjLightRig`
  - L947: function `applyFixedCameraPreset`
  - L995: function `applyViewerCameraSnapshot`
  - L1042: function `computeBoundsFromSceneSoA`
  - L1104: function `scaleAllFactor`
  - L1110: function `voptEnabled`
  - L1114: function `normalizeDeltaByViewportHeight`
  - L1121: function `meanSizeFromState`
  - L1135: function `computeScenePolicy`
  - L1161: function `disposeLabelTextureCache`
  - L1174: function `getLabelTexture`
  - L1235: function `createLabelSprite`
  - L1252: function `ensureLabelGroup`
  - L1264: function `hideLabelGroup`
  - L1275: function `updateSceneLabelOverlays`
  - L1347: function `updateInfinitePlaneFromSceneSoA`
  - L1488: function `getDefaultVopt`
  - L1496: function `applyMjvSceneSoAGeoms`
  - L2783: function `createRendererManager`
- 声明（嵌套）：
  - L112: const => `setSolidBackground`
  - L527: function `syncCameraPoseFromMode`
  - L1099: function `overlayScale`
  - L1129: function `computeMeanScale`
  - L1601: const => `isBodyStatic`
  - L1864: const => `safeHide`
  - L1872: const => `ensureGeomProxy`
  - L1906: const => `fillSizeVec`
  - L1932: const => `updateOne`
  - L2823: function `requestRenderScene`
  - L2829: function `onFrame`
  - L2842: function `updateRendererViewport`
  - L2863: function `ensureRenderLoop`
  - L2869: const => `step`
  - L2940: const => `visHandler`
  - L2956: function `initRenderer`
  - L3075: const => `resizeListener`
  - L3083: function `renderScene`
  - L3261: const => `trackingOverride`
  - L3533: function `setup`
  - L3538: function `getContext`
  - L3542: function `getOverlay3D`
  - L3548: function `dispose`
  - L3612: const => `disposeResource`
  - L3674: property => `updateViewport`
- 类成员（启发式）：（无）

### `renderer/scene_soa_geoms.mjs`

- 行数：1865
- 导出（Exports）：
  - L1831: export `GROUND_DISTANCE`
  - L1831: export `RENDER_ORDER`
  - L1831: export `TRANSPARENT_BIN_CAM_POS`
  - L1831: export `TRANSPARENT_BIN_CAM_DIR`
  - L1831: export `SEGMENT_FLAG_INDEX`
  - L1831: export `isInfinitePlaneSize`
  - L1831: export `isDynamicSizeScaleGeomType`
  - L1831: export `applyDynamicSizeScale`
  - L1831: export `disposeInstancing`
  - L1831: export `syncRendererAssets`
  - L1831: export `ensureInstancingRoot`
  - L1831: export `ensureInstancedGeometry`
  - L1831: export `instancingEnabledFromState`
  - L1831: export `transparentBinsFromState`
  - L1831: export `transparentSortModeFromState`
  - L1831: export `ensureInstancedMaterial`
  - L1831: export `ensureInstancedBatch`
  - L1831: export `sortInstancedBatchByOrderRank`
  - L1831: export `resolveGeomWorldMatrix`
  - L1831: export `resolveGeomWorldPose`
  - L1831: export `segmentColorForIndex`
  - L1831: export `restoreSegmentMaterial`
  - L1831: export `ensureSegmentMaterial`
  - L1831: export `applyMaterialFlags`
  - L1831: export `resolveMaterialReflectance`
  - L1831: export `resolveMaterialMetallic`
  - L1831: export `resolveMaterialRoughness`
  - L1831: export `resolveMaterialEmission`
  - L1831: export `applyReflectanceToMaterial`
  - L1831: export `ensureGeomMesh`
  - L1831: export `ensureGeomState`
  - L1831: export `setGeomViewProps`
- 声明（文件级）：
  - L11: function `createInfiniteGroundHelper`
  - L188: function `isInfinitePlaneSize`
  - L195: function `applyGeomMetadata`
  - L261: function `createPrimitiveGeometry`
  - L417: function `isDynamicSizeScaleGeomType`
  - L433: function `safeScaleRatio`
  - L440: function `ensureGeomBuiltSizes`
  - L508: function `applyDynamicSizeScale`
  - L577: function `createMeshGeometryFromAssets`
  - L855: function `disposeInstancing`
  - L895: class `MaterialPool`
  - L937: function `syncRendererAssets`
  - L992: function `ensureInstancingRoot`
  - L1027: function `ensureInstancedGeometry`
  - L1062: function `instancingEnabledFromState`
  - L1066: function `transparentBinsFromState`
  - L1072: function `transparentSortModeFromState`
  - L1078: function `ensureInstancedMaterial`
  - L1137: function `ensureInstancedBatch`
  - L1215: function `sortInstancedBatchByOrderRank`
  - L1313: function `resolveGeomWorldMatrix`
  - L1338: function `resolveGeomWorldPose`
  - L1345: function `getSharedMeshGeometry`
  - L1369: function `segmentColorForIndex`
  - L1375: function `restoreSegmentMaterial`
  - L1385: function `ensureSegmentMaterial`
  - L1406: function `applyMaterialFlags`
  - L1412: function `clampUnit`
  - L1419: function `resolveMaterialScalar`
  - L1427: function `resolveMaterialReflectance`
  - L1433: function `resolveMaterialMetallic`
  - L1438: function `resolveMaterialRoughness`
  - L1443: function `resolveMaterialEmission`
  - L1449: function `applyReflectanceToMaterial`
  - L1483: function `ensureGeomMesh`
  - L1671: function `ensureGeomState`
  - L1761: function `setGeomViewProps`
- 声明（嵌套）：（无）
- 类成员（启发式）：
  - L896: method `MaterialPool#constructor`
  - L900: method `MaterialPool#_key`
  - L929: method `MaterialPool#disposeAll`

### `renderer/three_helpers.mjs`

- 行数：161
- 导出（Exports）：
  - L154: export `computeGeometryBounds`
  - L154: export `disposeMeshObject`
  - L154: export `disposeObject3DTree`
  - L154: export `getWorldScene`
  - L154: export `renderWorldScene`
- 声明（文件级）：
  - L6: function `getWorldScene`
  - L13: function `renderWorldScene`
  - L33: function `computeGeometryBounds`
  - L38: function `disposeMeshObject`
  - L111: function `disposeObject3DTree`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

## ui/

### `ui/bindings.mjs`

- 行数：343
- 导出（Exports）：
  - L36: export function `resolveBindingSpec`
  - L144: export function `getControlBindingSpec`
  - L159: export function `parseVector`
  - L186: export function `toBoolean`
  - L239: export function `normaliseControlInput`
  - L291: export function `prepareBindingUpdate`
- 声明（文件级）：
  - L12: function `ensureBindingIndex`
  - L36: function `resolveBindingSpec`
  - L144: function `getControlBindingSpec`
  - L154: function `parseNumber`
  - L159: function `parseVector`
  - L186: function `toBoolean`
  - L200: function `normaliseEnumValue`
  - L218: function `normaliseValueByKind`
  - L239: function `normaliseControlInput`
  - L291: function `prepareBindingUpdate`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `ui/control_manager.mjs`

- 行数：2461
- 导出（Exports）：
  - L2460: export `createControlManager`
- 声明（文件级）：
  - L12: function `createControlManager`
  - L151: function `formatNumber`
  - L161: function `formatNumberTrimmed`
  - L169: function `attachCommitHandlers`
  - L185: function `attachOptionAvailability`
  - L193: function `appendUpdateOptions`
  - L206: function `pushToast`
  - L309: function `normaliseToRange`
  - L322: function `denormaliseFromRange`
  - L340: function `resolveCameraModeEntries`
  - L365: function `getCameraModeCount`
  - L375: function `syncCameraSelectOptions`
  - L408: function `resolveTrackingGeomEntries`
  - L430: function `syncTrackingGeomSelectOptions`
  - L465: function `resolveResetValue`
  - L481: function `normaliseShortcutSpec`
  - L505: function `canonicalShortcut`
  - L537: function `normaliseKeyToken`
  - L551: function `shortcutFromEvent`
- 声明（嵌套）：
  - L35: function `renderFileSectionExtras`
  - L41: function `applyThemeFromColorControl`
  - L52: function `applySpacingFromControl`
  - L66: function `applyFontFromControl`
  - L110: function `sanitiseName`
  - L120: function `normaliseOptions`
  - L129: const => `getOptionSupport`
  - L132: function `isOptionBinding`
  - L136: function `applyOptionAvailability`
  - L217: function `elementIsEditable`
  - L230: function `hasEditableFocus`
  - L253: function `parseRange`
  - L483: const => `addCombo`
  - L580: function `registerShortcutHandlers`
  - L589: function `registerGlobalShortcut`
  - L594: function `registerControl`
  - L602: function `createBinding`
  - L607: property => `setValue`
  - L617: function `guardBinding`
  - L624: function `createControlRow`
  - L635: function `createNamedRow`
  - L646: function `createFullRow`
  - L654: function `createLabeledRow`
  - L665: function `expandSection`
  - L671: function `appendGroupedEntries`
  - L719: function `loadUiSpec`
  - L732: function `createBoolToggleElements`
  - L758: function `renderDisabledCheckbox`
  - L764: function `renderCheckbox`
  - L770: property => `getValue`
  - L771: property => `applyValue`
  - L823: function `renderRunToggle`
  - L832: const => `sync`
  - L840: property => `getValue`
  - L844: property => `applyValue`
  - L865: function `renderButton`
  - L898: property => `getValue`
  - L899: property => `setValue`
  - L913: function `resolveColorLabel`
  - L940: function `resolveSpacingLabel`
  - L965: function `resolveFontLabel`
  - L1013: function `resolveSelectMeta`
  - L1033: function `syncSelectOptions`
  - L1050: function `readSelectValue`
  - L1065: function `applySelectValue`
  - L1115: function `renderSelect`
  - L1131: property => `getValue`
  - L1132: property => `applyValue`
  - L1162: function `buildSegmentedOptions`
  - L1185: function `createSegmentedGroup`
  - L1213: function `attachSegmentedHandlers`
  - L1227: function `renderVisualSourceControl`
  - L1257: const => `resolveKey`
  - L1266: property => `getValue`
  - L1267: property => `applyValue`
  - L1275: property => `onCommit`
  - L1288: function `renderRadio`
  - L1299: property => `getValue`
  - L1300: property => `applyValue`
  - L1307: property => `onCommit`
  - L1313: function `renderSlider`
  - L1335: const => `resolveRange`
  - L1374: property => `getValue`
  - L1381: property => `applyValue`
  - L1395: const => `updateAvailability`
  - L1426: const => `setEditing`
  - L1437: function `createTextInputField`
  - L1461: function `renderEditInput`
  - L1467: property => `getValue`
  - L1472: property => `applyValue`
  - L1529: function `renderVectorInputBase`
  - L1544: const => `formatVector`
  - L1546: const => `setInputText`
  - L1552: property => `getValue`
  - L1553: property => `applyValue`
  - L1579: const => `showInvalid`
  - L1610: function `renderVectorInput`
  - L1619: function `renderVec3StringInput`
  - L1628: function `renderStatic`
  - L1637: property => `getValue`
  - L1638: property => `applyValue`
  - L1660: function `renderWatchField`
  - L1672: const => `syncOptions`
  - L1686: property => `getValue`
  - L1687: property => `applyValue`
  - L1703: function `renderKeyframeSelect`
  - L1714: const => `syncOptions`
  - L1748: property => `getValue`
  - L1749: property => `applyValue`
  - L1770: function `renderSimulationNoiseNotice`
  - L1782: function `renderSeparator`
  - L1806: property => `edit_int`
  - L1807: property => `edit_float`
  - L1808: property => `edit_text`
  - L1809: property => `edit_vec2`
  - L1810: property => `edit_vec3`
  - L1811: property => `edit_vec3_string`
  - L1812: property => `edit_vec5`
  - L1813: property => `edit_rgba`
  - L1828: function `renderControl`
  - L1855: function `renderSection`
  - L1900: const => `setCollapsed`
  - L1916: const => `toggleCollapsed`
  - L1989: function `ensureDynamicList`
  - L2044: function `resolveListIndex`
  - L2049: function `ensureDynamicSliders`
  - L2067: property => `updateExisting`
  - L2103: property => `buildItem`
  - L2127: const => `clearEditing`
  - L2145: function `renderPanels`
  - L2167: function `updateControls`
  - L2187: function `toggleControl`
  - L2214: function `cycleCamera`
  - L2223: function `installShortcuts`
  - L2227: const => `handler`
  - L2259: function `dispose`
  - L2281: property => `getBinding`
  - L2283: property => `listIds`
  - L2288: property => `getControl`
  - L2289: property => `createSection`
  - L2308: property => `ensureActuatorSliders`
  - L2316: property => `getIndex`
  - L2317: property => `getLabel`
  - L2318: property => `getRange`
  - L2323: property => `getValue`
  - L2332: property => `onInput`
  - L2347: property => `ensureJointSliders`
  - L2355: property => `getIndex`
  - L2356: property => `getLabel`
  - L2357: property => `getRange`
  - L2364: property => `getValue`
  - L2366: property => `onInput`
  - L2386: property => `ensureEqualityToggles`
  - L2393: property => `updateExisting`
  - L2413: property => `buildItem`
- 类成员（启发式）：（无）

### `ui/file_section.mjs`

- 行数：665
- 导出（Exports）：
  - L8: export function `createFileSectionManager`
- 声明（文件级）：
  - L8: function `createFileSectionManager`
- 声明（嵌套）：
  - L16: function `createControlRow`
  - L27: function `createFullRow`
  - L39: const => `refreshModelSelectOptions`
  - L62: const => `addModelEntry`
  - L83: function `loadXmlTextAsModel`
  - L111: function `deriveXmlFileName`
  - L119: function `pickDirectoryHandle`
  - L132: function `promptDirectoryHandleForXmlRefs`
  - L147: const => `folderHint`
  - L203: const => `addRow`
  - L237: const => `cleanup`
  - L243: const => `resolveCancel`
  - L281: function `findFirstFileByName`
  - L314: function `getFileHandleByRelPath`
  - L329: function `readDirectoryFileArrayBuffer`
  - L335: function `buildMuJoCoBundle`
  - L344: function `readUrlFileArrayBuffer`
  - L355: function `loadXmlTextWithFolderRefs`
  - L410: function `loadXmlTextWithUrlRefs`
  - L454: function `renderFileSectionExtras`
  - L515: const => `loadXmlFileImpl`
- 类成员（启发式）：（无）

### `ui/panel_sections.mjs`

- 行数：188
- 导出（Exports）：
  - L67: export function `readPersistedSectionCollapsed`
  - L78: export function `writePersistedSectionCollapsed`
  - L89: export function `resolvePlayPanelId`
  - L100: export function `setPlaySectionCollapsed`
  - L129: export function `toggleAllPlaySections`
  - L161: export function `installPanelSectionDblclickDelegation`
- 声明（文件级）：
  - L16: function `sectionCollapsedMapKey`
  - L22: function `getSectionCollapsedCache`
  - L44: function `flushSectionCollapsedCache`
  - L58: function `queueSectionCollapsedFlush`
  - L67: function `readPersistedSectionCollapsed`
  - L78: function `writePersistedSectionCollapsed`
  - L89: function `resolvePlayPanelId`
  - L100: function `setPlaySectionCollapsed`
  - L129: function `toggleAllPlaySections`
  - L161: function `installPanelSectionDblclickDelegation`
- 声明（嵌套）：
  - L166: const => `handler`
- 类成员（启发式）：（无）

### `ui/state.mjs`

- 行数：1696
- 导出（Exports）：
  - L33: export function `clamp01`
  - L1687: export `DEFAULT_VIEWER_STATE`
  - L1687: export `applyGesture`
  - L1687: export `applySpecAction`
  - L1687: export `createViewerStore`
  - L1687: export `mergeBackendSnapshot`
  - L1687: export `readControlValue`
  - L1687: export `resetModelFrontendState`
- 声明（文件级）：
  - L33: function `clamp01`
  - L59: function `resolveRealTimeIndexFromRate`
  - L75: function `createDefaultSelectionState`
  - L90: function `resetSelectionState`
  - L134: function `flagsFromMask`
  - L307: function `cloneViewerState`
  - L311: function `applyViewerStateOverrides`
  - L320: function `formatStructPath`
  - L324: function `valuesEqual`
  - L336: function `diffStruct`
  - L353: function `resetModelFrontendState`
  - L362: function `cameraLabelFromIndex`
  - L375: function `mergeBackendSnapshot`
  - L829: function `ensureRenderingState`
  - L911: function `ensureState`
  - L919: const => `ensureHistoryState`
  - L920: const => `ensureWatchState`
  - L921: const => `ensureKeyframeState`
  - L923: function `ensureThemeState`
  - L956: function `parseThemeBinary`
  - L1079: function `applyBinding`
  - L1089: function `formatKeyframeLabelFromState`
  - L1121: function `applyControl`
  - L1157: function `readBindingValue`
  - L1173: function `readControlValue`
  - L1197: function `createViewerStore`
  - L1237: function `applySpecAction`
  - L1291: function `applyGesture`
  - L1410: function `applyPresetOverridesToStruct`
  - L1431: function `applyAppearancePresetOverrides`
  - L1449: function `ensureVisualCache`
  - L1458: function `switchVisualSourceMode`
  - L1673: function `normaliseSceneFlagArray`
- 声明（嵌套）：
  - L970: property => `overlay`
  - L974: property => `theme`
  - L1015: property => `tracking_geom`
  - L1023: property => `overlay`
  - L1024: property => `run`
  - L1030: property => `camera`
  - L1031: property => `tracking_geom`
  - L1032: property => `scrub_index`
  - L1033: property => `key_index`
  - L1034: property => `watch_field`
  - L1035: property => `watch_index`
  - L1036: property => `theme`
  - L1037: property => `watch_summary`
  - L1044: property => `group`
  - L1053: property => `mask`
  - L1060: property => `sim_opt`
  - L1061: property => `struct`
  - L1073: property => `vopt_flag`
  - L1074: property => `scene_flag`
  - L1075: property => `label_mode`
  - L1076: property => `frame_mode`
  - L1202: function `notify`
- 类成员（启发式）：（无）

## worker/

### `worker/dispatch.gen.mjs`

- 行数：90
- 导出（Exports）：
  - L19: export function `encodeCommand`
  - L31: export function `decodeCommand`
  - L44: export function `dispatchCommand`
  - L55: export function `encodeEvent`
  - L67: export function `decodeEvent`
  - L80: export function `dispatchEvent`
- 声明（文件级）：
  - L8: function `assertPayloadFields`
  - L19: function `encodeCommand`
  - L31: function `decodeCommand`
  - L44: function `dispatchCommand`
  - L55: function `encodeEvent`
  - L67: function `decodeEvent`
  - L80: function `dispatchEvent`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `worker/physics.worker.mjs`

- 行数：3431
- 导出（Exports）：（无）
- 声明（文件级）：
  - L144: function `buildPerf`
  - L160: function `safePost`
  - L186: function `setRunning`
  - L198: function `resetTimingForCurrentSim`
  - L220: function `readStructState`
  - L231: function `createGroupState`
  - L241: function `cloneGroupState`
  - L250: function `cloneSceneFlags`
  - L262: function `maybeSyncTimestepFromOptions`
  - L272: function `emitOptionState`
  - L295: function `getOptionsForSnapshot`
  - L319: function `syncVoptToWasm`
  - L356: function `ensureMjvPerturbAbi`
  - L399: function `ensureMjvCameraAbi`
  - L431: function `mjvMouseActionFor`
  - L442: function `writeViewerCameraFromPayload`
  - L482: function `readViewerFreeCameraState`
  - L506: function `clearPerturbXfrcIfNeeded`
  - L517: function `applyMjvPerturbForceIfActive`
  - L528: function `applySimulatePerturbPipeline`
  - L559: function `emitStructState`
  - L565: function `collectCameraMeta`
  - L620: function `emitCameraMeta`
  - L630: function `collectGeomMeta`
  - L644: function `emitGeomMeta`
  - L654: function `normaliseInt`
  - L659: function `clamp`
  - L663: function `initHistoryBuffers`
  - L700: function `serializeHistoryMeta`
  - L723: function `emitHistoryMeta`
  - L730: function `buildInfoStats`
  - L911: function `captureHistorySample`
  - L927: function `releaseHistoryScrub`
  - L937: function `loadHistoryOffset`
  - L965: function `applyHistoryConfig`
  - L984: function `resetKeyframes`
  - L1027: function `serializeKeyframeMeta`
  - L1046: function `emitKeyframeMeta`
  - L1053: function `ensureKeySlot`
  - L1066: function `saveKeyframe`
  - L1086: function `loadKeyframe`
  - L1100: function `resetWatchState`
  - L1113: function `resolveWatchField`
  - L1120: function `updateWatchTarget`
  - L1134: function `readWatchView`
  - L1156: function `sampleWatch`
  - L1191: function `emitWatchState`
  - L1197: function `collectWatchSources`
  - L1224: function `wasmUrl`
  - L1228: function `cstr`
  - L1232: function `readLastErrorMeta`
  - L1252: function `readErrno`
  - L1257: function `readModelCount`
  - L1269: function `readDataCount`
  - L1281: function `readPtr`
  - L1294: const => `readModelPtr`
  - L1295: const => `readDataPtr`
  - L1297: function `computeBoundsFromPositions`
  - L1338: function `captureBounds`
  - L1350: function `captureCopyState`
  - L1434: function `loadModule`
  - L1601: function `loadXmlWithFallback`
  - L1657: function `snapshot`
  - L2148: function `emitRenderAssets`
  - L2175: function `collectAssetBuffersForTransfer`
  - L3415: function `dispatchCommandMessage`
- 声明（嵌套）：
  - L322: const => `writeScalar`
  - L327: const => `writeGroup`
  - L570: const => `readFloat`
  - L580: const => `readInt`
  - L1199: const => `add`
  - L1453: const => `resolveLocalDistBase`
  - L1484: const => `assertForgeViewerAbi`
  - L1603: const => `ensureSim`
  - L2070: const => `transfers`
  - L2178: const => `push`
  - L2580: property => `strictReport`
  - L2583: property => `load`
  - L2598: const => `initOptions`
  - L2713: const => `jnt_names`
  - L2771: property => `reset`
  - L2781: property => `step`
  - L2802: property => `gesture`
  - L2878: property => `setVoptFlag`
  - L2888: property => `setSceneFlag`
  - L2900: property => `setLabelMode`
  - L2906: property => `setFrameMode`
  - L2912: property => `setCameraMode`
  - L2917: property => `setGroupState`
  - L2930: property => `historyScrub`
  - L2939: property => `historyConfig`
  - L2942: property => `keyframeSave`
  - L2948: property => `keyframeLoad`
  - L2955: property => `keyframeSelect`
  - L2964: property => `setWatch`
  - L2969: property => `setVisualOption`
  - L2986: property => `setField`
  - L3036: property => `applyPerturb`
  - L3108: property => `setSelection`
  - L3158: property => `selectAt`
  - L3318: property => `align`
  - L3331: property => `copyState`
  - L3337: property => `setCtrlNoise`
  - L3338: property => `setCtrl`
  - L3342: property => `setQpos`
  - L3360: property => `setEqualityActive`
  - L3375: property => `setRate`
  - L3379: property => `setSnapshotHz`
  - L3400: property => `setPaused`
  - L3410: property => `snapshot`
- 类成员（启发式）：（无）

### `worker/protocol.gen.mjs`

- 行数：198
- 导出（Exports）：
  - L3: export const `SNAPSHOT_VIEW_FIELDS`
  - L10: export const `GEOM_VIEW_FIELDS_OPTIONAL`
  - L17: export const `GEOM_VIEW_FIELDS_ALWAYS`
  - L22: export const `WORKER_COMMANDS`
  - L57: export const `WORKER_EVENTS`
  - L81: export const `COMMAND_FIELDS`
  - L116: export const `EVENT_FIELDS`
  - L140: export const `SNAPSHOT_TRANSFER_FIELDS`
  - L171: export const `CONTACT_TRANSFER_FIELDS`
  - L185: export function `collectSnapshotTransfersInto`
  - L195: export function `collectSnapshotTransfers`
- 声明（文件级）：
  - L173: function `collectBuffers`
  - L185: function `collectSnapshotTransfersInto`
  - L195: function `collectSnapshotTransfers`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `worker/snapshot_pool.mjs`

- 行数：117
- 导出（Exports）：
  - L10: export const `SNAPSHOT_POOL`
  - L38: export const `DIRTY_REASON`
  - L53: export function `markDirty`
  - L62: export function `snapshotPoolSetHz`
  - L71: export function `snapshotPoolMarkDirty`
  - L75: export function `snapshotPoolMarkAllDirty`
  - L79: export function `snapshotPoolResetTimers`
  - L83: export function `snapshotPoolShouldUpdate`
  - L91: export function `snapshotPoolDidUpdate`
- 声明（文件级）：
  - L32: function `snapshotPoolMarkDirtyMany`
  - L53: function `markDirty`
  - L62: function `snapshotPoolSetHz`
  - L71: function `snapshotPoolMarkDirty`
  - L75: function `snapshotPoolMarkAllDirty`
  - L79: function `snapshotPoolResetTimers`
  - L83: function `snapshotPoolShouldUpdate`
  - L91: function `snapshotPoolDidUpdate`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

## tools/

### `tools/check_module_boundaries.mjs`

- 行数：163
- 导出（Exports）：（无）
- 声明（文件级）：
  - L5: function `runGit`
  - L13: function `toPosix`
  - L17: function `layerOf`
  - L60: function `extractImportSpecifiers`
  - L78: function `resolveRelativeImport`
  - L98: function `shouldSkipFile`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tools/dev_server.py`

- 行数：160
- 导出（Exports）：（无）
- 声明（文件级）：
  - L37: class `Handler`
  - L135: def `main`
- 声明（嵌套）：
  - L38: def `_has_header`
  - L45: def `translate_path`
  - L60: def `end_headers`
  - L69: def `guess_type`
  - L87: def `send_head`
- 类成员（启发式）：（无）

### `tools/forbid_patterns.mjs`

- 行数：271
- 导出（Exports）：（无）
- 声明（文件级）：
  - L63: function `stripStringsAndComments`
  - L151: function `buildLineIndex`
  - L159: function `indexToLineCol`
  - L175: function `walk`
  - L192: function `findCatchViolations`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tools/generate_code_inventory.mjs`

- 行数：440
- 导出（Exports）：（无）
- 声明（文件级）：
  - L50: function `listTrackedFiles`
  - L67: function `isExcluded`
  - L71: function `inferGroup`
  - L85: function `parseExportBlock`
  - L128: function `parseJsLike`
  - L295: function `parsePython`
  - L327: function `buildInventory`
  - L354: function `renderMarkdown`
  - L428: function `writeDocs`
- 声明（嵌套）：
  - L135: function `pushDecl`
  - L140: function `isCommentLike`
  - L145: function `recordClassMembers`
  - L300: function `pushDecl`
- 类成员（启发式）：（无）

### `tools/generate_ui_artifacts.mjs`

- 行数：866
- 导出（Exports）：（无）
- 声明（文件级）：
  - L20: function `requireArray`
  - L27: function `requireNumber`
  - L47: function `sanitiseName`
  - L57: function `expandSection`
  - L125: function `collectControls`
  - L136: function `splitBinding`
  - L145: function `inferMetaFromControl`
  - L180: function `resolveBindingMeta`
  - L204: function `buildBindingIndex`
  - L244: function `addDescriptor`
  - L261: function `collectDescriptors`
  - L287: function `collectOptionFields`
  - L313: function `buildOptionLayout`
  - L325: function `buildFieldPointers`
  - L444: function `renderViewerDefaults`
  - L482: function `renderViewerShared`
  - L486: function `renderViewerStructs`
  - L849: function `renderViewerTypes`
- 声明（嵌套）：
  - L72: function `appendGroupedEntries`
- 类成员（启发式）：（无）

### `tools/generate_worker_protocol.mjs`

- 行数：240
- 导出（Exports）：（无）
- 声明（文件级）：
  - L25: function `normaliseFieldList`
  - L45: function `normaliseTransferFields`
  - L52: function `normaliseNameList`
  - L59: function `normaliseMessageSpec`
  - L90: function `renderFieldList`
  - L95: function `renderFieldSpec`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tools/loc_report.mjs`

- 行数：141
- 导出（Exports）：（无）
- 声明（文件级）：
  - L42: function `isTextFile`
  - L46: function `isGeneratedFile`
  - L54: function `countLines`
  - L60: function `listTrackedFiles`
  - L70: function `walkDir`
  - L87: function `isShipPath`
  - L103: function `getShipRelPath`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tools/run_checks.mjs`

- 行数：68
- 导出（Exports）：（无）
- 声明（文件级）：
  - L5: function `run`
  - L17: function `listNodeTests`
  - L27: function `fileExists`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

## tests/

### `tests/e2e/contact_overlays_humanoid_debug.spec.ts`

- 行数：126
- 导出（Exports）：（无）
- 声明（文件级）：
  - L10: function `enableContactFlagsViaControls`
  - L34: function `waitForContacts`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/convex-hull-parity.spec.ts`

- 行数：151
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：
  - L91: const => `readHullState`
- 类成员（启发式）：（无）

### `tests/e2e/default-init-debug.spec.ts`

- 行数：40
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/equality-panel.spec.ts`

- 行数：69
- 导出（Exports）：（无）
- 声明（文件级）：
  - L7: function `readEqualitySnapshot`
  - L23: function `readEqualityDom`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/flex-layer-parity.spec.ts`

- 行数：54
- 导出（Exports）：（无）
- 声明（文件级）：
  - L7: function `setSliderNormalised`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/geomorder-dump.spec.ts`

- 行数：87
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：
  - L33: const => `label`
- 类成员（启发式）：（无）

### `tests/e2e/humanoid100-model-ref-load.spec.ts`

- 行数：33
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/info-overlay.spec.ts`

- 行数：100
- 导出（Exports）：（无）
- 声明（文件级）：
  - L4: function `openInfoOverlay`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/instancing-instancecolor-attr.spec.ts`

- 行数：88
- 导出（Exports）：（无）
- 声明（文件级）：
  - L7: function `pauseSimulation`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/instancing-site-tendon-parity.spec.ts`

- 行数：201
- 导出（Exports）：（无）
- 声明（文件级）：
  - L7: function `pauseSimulation`
- 声明（嵌套）：
  - L57: const => `resolveScnIndex`
- 类成员（启发式）：（无）

### `tests/e2e/instancing-visual-parity.spec.ts`

- 行数：300
- 导出（Exports）：（无）
- 声明（文件级）：
  - L7: function `pauseSimulation`
- 声明（嵌套）：
  - L85: const => `samplePatchFromCanvas`
  - L109: const => `projectScnToPixel`
  - L121: const => `samplePixels`
  - L155: const => `resolveMeshIndex`
  - L171: const => `warmupNonInstancedMeshes`
- 类成员（启发式）：（无）

### `tests/e2e/mjvscene-export.spec.ts`

- 行数：113
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/mjvscene-skin-diag.spec.ts`

- 行数：58
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/model-scan.local.spec.ts`

- 行数：93
- 导出（Exports）：（无）
- 声明（文件级）：
  - L7: function `listXmlFiles`
- 声明（嵌套）：
  - L9: const => `walk`
- 类成员（启发式）：（无）

### `tests/e2e/model-switch-reset.spec.ts`

- 行数：47
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/perf-phases.spec.ts`

- 行数：199
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：
  - L132: const => `pick`
- 类成员（启发式）：（无）

### `tests/e2e/physics-options.spec.ts`

- 行数：265
- 导出（Exports）：（无）
- 声明（文件级）：
  - L11: function `readPhysicsOptions`
  - L37: function `readPhysicsFlags`
- 声明（嵌套）：
  - L78: const => `byId`
  - L107: const => `apply`
  - L207: const => `setChecked`
- 类成员（启发式）：（无）

### `tests/e2e/raj_single_reset_memory.spec.ts`

- 行数：43
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：
  - L14: const => `readTime`
- 类成员（启发式）：（无）

### `tests/e2e/raj-site-tendon-rgba.spec.ts`

- 行数：101
- 导出（Exports）：（无）
- 声明（文件级）：
  - L15: function `summarize`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/rendering-behaviors.spec.ts`

- 行数：58
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/skybox-toggle.spec.ts`

- 行数：165
- 导出（Exports）：（无）
- 声明（文件级）：
  - L7: function `readSkyState`
  - L27: function `readSkyDebug`
  - L59: function `setVisualSource`
  - L73: function `setSkyboxState`
- 声明（嵌套）：
  - L87: const => `skyState`
- 类成员（启发式）：（无）

### `tests/e2e/slidercrank-parity.spec.ts`

- 行数：94
- 导出（Exports）：（无）
- 声明（文件级）：
  - L9: function `readSlidercrankSummary`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/static-transparent-parity.spec.ts`

- 行数：158
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：
  - L55: const => `isStatic`
- 类成员（启发式）：（无）

### `tests/e2e/strict_gate.spec.mjs`

- 行数：78
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/tendon-catenary-parity.spec.ts`

- 行数：95
- 导出（Exports）：（无）
- 声明（文件级）：
  - L7: function `sceneTendonCounts`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/test-utils.ts`

- 行数：68
- 导出（Exports）：
  - L5: export function `ensureSectionExpanded`
  - L23: export function `waitForViewerReady`
  - L44: export function `loadXmlFromFileInput`
  - L55: export function `firstVisibleGeomSummary`
- 声明（文件级）：
  - L5: function `ensureSectionExpanded`
  - L23: function `waitForViewerReady`
  - L44: function `loadXmlFromFileInput`
  - L55: function `firstVisibleGeomSummary`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/texture-flag-parity.spec.ts`

- 行数：111
- 导出（Exports）：（无）
- 声明（文件级）：
  - L7: function `pickMeshWithMap`
  - L39: function `meshMapState`
  - L55: function `forceRender`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/transparent-strict-ordering.spec.ts`

- 行数：93
- 导出（Exports）：（无）
- 声明（文件级）：
  - L7: function `pauseSimulation`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/ui_kit_contract.spec.ts`

- 行数：34
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/ui_sections_contract.spec.ts`

- 行数：61
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/e2e/worker-time-advances.spec.ts`

- 行数：30
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/microbench/flex.microbench.spec.ts`

- 行数：207
- 导出（Exports）：（无）
- 声明（文件级）：
  - L21: function `pickStat`
  - L27: function `extractTopMs`
  - L38: function `meanFpsFromInterval`
  - L44: function `clearPerfSamples`
  - L52: function `readPerfSummary`
  - L60: function `ensureSimRunning`
  - L72: function `minimizeUi`
  - L89: function `rotateCameraFor`
- 声明（嵌套）：
  - L128: const => `extract`
  - L182: function `runPhase`
- 类成员（启发式）：（无）

### `tests/playwright.config.mjs`

- 行数：100
- 导出（Exports）：
  - L75: export default `(default)`
- 声明（文件级）：
  - L14: function `isFinitePort`
  - L18: function `isPortOpen`
  - L40: function `pickPort`
- 声明（嵌套）：
  - L21: const => `settle`
- 类成员（启发式）：（无）

### `tests/playwright.microbench.config.mjs`

- 行数：99
- 导出（Exports）：
  - L75: export default `(default)`
- 声明（文件级）：
  - L14: function `isFinitePort`
  - L18: function `isPortOpen`
  - L40: function `pickPort`
- 声明（嵌套）：
  - L21: const => `settle`
- 类成员（启发式）：（无）

### `tests/scripts/sky_debug_playwright.py`

- 行数：168
- 导出（Exports）：（无）
- 声明（文件级）：
  - L12: def `main`
- 声明（嵌套）：
  - L34: def `on_console`
- 类成员（启发式）：（无）

### `tests/tooling/validate_spec.mjs`

- 行数：114
- 导出（Exports）：（无）
- 声明（文件级）：
  - L9: function `fail`
  - L13: function `readJson`
  - L22: function `requireNonEmptyArray`
  - L29: function `requireFiniteNumber`
  - L37: function `validateUiSpec`
  - L80: function `validateProtocol`
- 声明（嵌套）：
  - L54: function `registerItemId`
  - L63: function `validateSection`
  - L85: function `validateEntries`
- 类成员（启发式）：（无）

### `tests/unit/protocol_dispatch.test.mjs`

- 行数：73
- 导出（Exports）：（无）
- 声明（文件级）：
  - L14: function `payloadWithRequiredFields`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/unit/ui_snapshot_merge.test.mjs`

- 行数：76
- 导出（Exports）：（无）
- 声明（文件级）：
  - L6: function `clone`
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）

### `tests/unit/ui_spec_action.test.mjs`

- 行数：22
- 导出（Exports）：（无）
- 声明（文件级）：（未发现）
- 声明（嵌套）：（无）
- 类成员（启发式）：（无）
