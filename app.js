import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import {
    ChevronDown,
    Cpu,
    Download,
    FileVideo,
    Info,
    Trash2,
    TriangleAlert,
    Upload,
    X,
    Zap,
    createIcons,
} from "lucide";
import {
    clearAllRecords,
    deleteRecord,
    getAllRecords,
    getHistoryTotalSize,
    pruneOldRecords,
    saveRecord,
} from "./db.js";

const ALL_ICONS = {
    Upload,
    X,
    FileVideo,
    Info,
    ChevronDown,
    Trash2,
    Download,
    Cpu,
    Zap,
    TriangleAlert,
};

const outputSuffix = "_enhanced";
const supportedMimeTypes = [
    "video/mp4",
    "video/quicktime",
    "video/x-quicktime",
];
const supportedExtensions = [".mp4", ".mov"];

const fileInput = document.getElementById("fileInput");
const patchBtn = document.getElementById("patchBtn");
const clearBtn = document.getElementById("clearBtn");
const dropZone = document.getElementById("dropZone");
const statusLog = document.getElementById("statusLog");
const progressBar = document.getElementById("progressBar");
const progressTrack = document.getElementById("progressTrack");
const fileListEl = document.getElementById("fileList");
const historyList = document.getElementById("historyList");
const historyBadge = document.getElementById("historyBadge");
const historyToggleBtn = document.getElementById("historyToggleBtn");
const historyDrawer = document.getElementById("historyDrawer");
const historyHeader = document.getElementById("historyHeader");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");

let selectedFiles = [];
let currentFlowState = "idle";
let isCancelled = false;

let lastWidth = null;
function adjustMobileLayout() {
    const currentWidth = window.innerWidth;
    if (lastWidth !== null && currentWidth === lastWidth) return;
    lastWidth = currentWidth;

    const isMobile = currentWidth <= 900;
    const header = document.querySelector(".header");
    const panelLeft = document.querySelector(".panel-left");
    const panelRight = document.querySelector(".panel-right");
    const dropZone = document.getElementById("dropZone");
    if (isMobile) {
        if (dropZone && header && dropZone.parentNode !== panelLeft) {
            header.after(dropZone);
        }
    } else {
        if (dropZone && panelRight && dropZone.parentNode !== panelRight) {
            panelRight.insertBefore(dropZone, panelRight.firstChild);
        }
    }
}

function initializeApp() {
    createIcons({
        icons: ALL_ICONS,
    });
    pruneOldRecords()
        .then(() => renderHistoryList())
        .catch(() => {});
    adjustMobileLayout();
    window.addEventListener("resize", adjustMobileLayout);
}

function logMessage(text, type = "info") {
    const row = document.createElement("div");
    row.className = `log-row log-${type}`;
    row.textContent = text;
    statusLog.appendChild(row);
    statusLog.scrollTop = statusLog.scrollHeight;
}

function clearLog() {
    statusLog.innerHTML = "";
}

function setProgress(percent) {
    progressBar.style.width = `${percent}%`;
}

function showProgress() {
    progressTrack.classList.add("active");
    progressTrack.style.opacity = "1";
}

function hideProgress() {
    setTimeout(() => {
        progressTrack.style.opacity = "0";
        setTimeout(() => {
            setProgress(0);
            progressTrack.classList.remove("active");
        }, 400);
    }, 800);
}

function isSupportedFile(file) {
    const lowerName = file.name.toLowerCase();
    return (
        supportedMimeTypes.includes(file.type) ||
        supportedExtensions.some((ext) => lowerName.endsWith(ext))
    );
}

function getMimeType(file) {
    const lowerName = file.name.toLowerCase();
    if (file.type && supportedMimeTypes.includes(file.type)) return file.type;
    if (lowerName.endsWith(".mov")) return "video/quicktime";
    return "video/mp4";
}

function getOutputFilename(file) {
    const match = file.name.match(/^(.+)(\.[^.]+)$/);
    if (!match) return file.name + outputSuffix;
    return match[1] + outputSuffix + match[2];
}

export function captureVideoFrame(file) {
    return new Promise((resolve) => {
        const video = document.createElement("video");
        video.preload = "auto";
        video.muted = true;
        video.playsInline = true;

        const objectUrl = URL.createObjectURL(file);
        const timeoutId = setTimeout(() => {
            video.src = "";
            video.load();
            URL.revokeObjectURL(objectUrl);
            resolve(null);
        }, 5000);

        video.src = objectUrl;

        video.onloadeddata = () => {
            video.currentTime = 0.1;
        };

        video.onseeked = () => {
            clearTimeout(timeoutId);
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            const maxDimension = 120;
            let width = video.videoWidth;
            let height = video.videoHeight;

            if (width > height) {
                if (width > maxDimension) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                }
            } else {
                if (height > maxDimension) {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(video, 0, 0, width, height);

            const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
            video.onloadeddata = null;
            video.onseeked = null;
            video.onerror = null;
            video.src = "";
            video.load();
            URL.revokeObjectURL(objectUrl);
            resolve(dataUrl);
        };

        video.onerror = () => {
            clearTimeout(timeoutId);
            video.onloadeddata = null;
            video.onseeked = null;
            video.onerror = null;
            video.src = "";
            video.load();
            URL.revokeObjectURL(objectUrl);
            resolve(null);
        };
    });
}

function formatFileSize(bytes) {
    if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
    if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

export function parseBoxes(bytes, view, startOffset, endOffset) {
    const boxes = [];
    let offset = startOffset;
    while (offset + 8 <= endOffset) {
        const rawSize = view.getUint32(offset, false);
        let size;
        let is64Bit = false;

        if (rawSize === 0) {
            size = endOffset - offset;
        } else if (rawSize === 1) {
            is64Bit = true;
            if (offset + 16 > endOffset) break;
            const hi = view.getUint32(offset + 8, false);
            const lo = view.getUint32(offset + 12, false);
            const sizeBig = (BigInt(hi) << 32n) + BigInt(lo);
            size = Number(sizeBig);
        } else {
            size = rawSize;
        }

        if (size < 8 || offset + size > endOffset) break;

        const type = String.fromCharCode(
            bytes[offset + 4],
            bytes[offset + 5],
            bytes[offset + 6],
            bytes[offset + 7],
        );
        boxes.push({ offset, size, type, end: offset + size, is64Bit });
        offset += size;
    }
    return boxes;
}

function getTkhdDuration(bytes, view, tkhdOffset) {
    const version = bytes[tkhdOffset + 8];
    if (version === 1) {
        return Number(view.getBigUint64(tkhdOffset + 36, false));
    }
    return view.getUint32(tkhdOffset + 28, false);
}

export function buildEdtsAtom(duration) {
    const useVersion1 = duration > 0xffffffff;
    const elstSize = useVersion1 ? 36 : 28;
    const edtsSize = 8 + elstSize;
    const buffer = new ArrayBuffer(edtsSize);
    const b = new Uint8Array(buffer);
    const v = new DataView(buffer);

    v.setUint32(0, edtsSize, false);
    b[4] = 0x65;
    b[5] = 0x64;
    b[6] = 0x74;
    b[7] = 0x73;

    v.setUint32(8, elstSize, false);
    b[12] = 0x65;
    b[13] = 0x6c;
    b[14] = 0x73;
    b[15] = 0x74;

    if (useVersion1) {
        v.setUint32(16, 0x01000000, false);
        v.setUint32(20, 1, false);
        v.setBigUint64(24, BigInt(duration), false);
        v.setBigInt64(32, 0n, false);
        v.setUint32(40, 0x00010000, false);
    } else {
        v.setUint32(16, 0, false);
        v.setUint32(20, 1, false);
        v.setUint32(24, duration, false);
        v.setInt32(28, 0, false);
        v.setUint32(32, 0x00010000, false);
    }

    return b;
}

function getBoxHeaderSize(box) {
    return box.is64Bit ? 16 : 8;
}

function updateBoxSize(view, offset, box, addedBytes) {
    if (box.is64Bit) {
        view.setBigUint64(offset + 8, BigInt(box.size + addedBytes), false);
    } else {
        view.setUint32(offset, box.size + addedBytes, false);
    }
}

function updateChunkOffsets(newBytes, newView, boxStart, boxEnd, delta) {
    const containerTypes = new Set(["moov", "trak", "mdia", "minf", "stbl"]);
    for (const box of parseBoxes(newBytes, newView, boxStart, boxEnd)) {
        if (box.type === "stco") {
            const headerSize = getBoxHeaderSize(box);
            const count = newView.getUint32(box.offset + headerSize + 4, false);
            for (let i = 0; i < count; i++) {
                const pos = box.offset + headerSize + 8 + i * 4;
                newView.setUint32(
                    pos,
                    newView.getUint32(pos, false) + delta,
                    false,
                );
            }
        } else if (box.type === "co64") {
            const headerSize = getBoxHeaderSize(box);
            const count = newView.getUint32(box.offset + headerSize + 4, false);
            for (let i = 0; i < count; i++) {
                const pos = box.offset + headerSize + 8 + i * 8;
                const currentOffset = newView.getBigUint64(pos, false);
                newView.setBigUint64(pos, currentOffset + BigInt(delta), false);
            }
        } else if (containerTypes.has(box.type)) {
            updateChunkOffsets(
                newBytes,
                newView,
                box.offset + getBoxHeaderSize(box),
                box.end,
                delta,
            );
        }
    }
}

export function rebuildWithElstBypass(inputBytes, inputView) {
    const fileSize = inputBytes.length;
    const topBoxes = parseBoxes(inputBytes, inputView, 0, fileSize);
    const moovBox = topBoxes.find((b) => b.type === "moov");
    if (!moovBox) return null;

    const mdatBox = topBoxes.find((b) => b.type === "mdat");
    const moovBeforeMdat = mdatBox && moovBox.offset < mdatBox.offset;

    const moovChildren = parseBoxes(
        inputBytes,
        inputView,
        moovBox.offset + getBoxHeaderSize(moovBox),
        moovBox.end,
    );
    const modifications = [];

    for (const trak of moovChildren.filter((b) => b.type === "trak")) {
        const trakChildren = parseBoxes(
            inputBytes,
            inputView,
            trak.offset + getBoxHeaderSize(trak),
            trak.end,
        );
        const tkhdBox = trakChildren.find((b) => b.type === "tkhd");
        const duration = tkhdBox
            ? getTkhdDuration(inputBytes, inputView, tkhdBox.offset)
            : 0;
        const edtsBox = trakChildren.find((b) => b.type === "edts");

        if (edtsBox) {
            modifications.push({
                removeStart: edtsBox.offset,
                removeEnd: edtsBox.end,
                trakBox: trak,
                edtsBytes: buildEdtsAtom(duration),
                addedDelta: 36 - edtsBox.size,
            });
        } else {
            const mdiaBox = trakChildren.find((b) => b.type === "mdia");
            const insertAt = mdiaBox ? mdiaBox.offset : trak.end;
            modifications.push({
                removeStart: insertAt,
                removeEnd: insertAt,
                trakBox: trak,
                edtsBytes: buildEdtsAtom(duration),
                addedDelta: 36,
            });
        }
    }

    if (modifications.length === 0) return null;

    modifications.sort((a, b) => a.removeStart - b.removeStart);

    const totalDelta = modifications.reduce(
        (sum, mod) => sum + mod.addedDelta,
        0,
    );
    const newBuffer = new ArrayBuffer(fileSize + totalDelta);
    const newBytes = new Uint8Array(newBuffer);
    const newView = new DataView(newBuffer);

    let readPos = 0;
    let writePos = 0;

    for (const mod of modifications) {
        newBytes.set(inputBytes.subarray(readPos, mod.removeStart), writePos);
        writePos += mod.removeStart - readPos;
        newBytes.set(mod.edtsBytes, writePos);
        writePos += mod.edtsBytes.length;
        readPos = mod.removeEnd;
    }

    newBytes.set(inputBytes.subarray(readPos), writePos);

    let cumulativeDelta = 0;
    for (const mod of modifications) {
        updateBoxSize(
            newView,
            mod.trakBox.offset + cumulativeDelta,
            mod.trakBox,
            mod.addedDelta,
        );
        cumulativeDelta += mod.addedDelta;
    }

    updateBoxSize(newView, moovBox.offset, moovBox, totalDelta);

    if (moovBeforeMdat) {
        updateChunkOffsets(
            newBytes,
            newView,
            moovBox.offset + getBoxHeaderSize(moovBox),
            moovBox.offset + moovBox.size + totalDelta,
            totalDelta,
        );
    }

    const replacedCount = modifications.filter(
        (m) => m.removeStart !== m.removeEnd,
    ).length;
    const injectedCount = modifications.length - replacedCount;

    return { newBytes, newBuffer, replacedCount, injectedCount };
}

export function patchMvhdMatrix(bytes, view) {
    const fileSize = bytes.length;
    const topBoxes = parseBoxes(bytes, view, 0, fileSize);
    const moovBox = topBoxes.find((b) => b.type === "moov");
    if (!moovBox) return null;

    const moovChildren = parseBoxes(
        bytes,
        view,
        moovBox.offset + getBoxHeaderSize(moovBox),
        moovBox.end,
    );
    const mvhdBox = moovChildren.find((b) => b.type === "mvhd");
    if (!mvhdBox) return null;

    const contentStart = mvhdBox.offset + getBoxHeaderSize(mvhdBox);
    const version = bytes[contentStart];
    let matrixOffset;
    if (version === 0) {
        matrixOffset = contentStart + 36;
    } else if (version === 1) {
        matrixOffset = contentStart + 48;
    } else {
        return null;
    }

    const matrixBOffset = matrixOffset + 4;
    if (matrixBOffset + 4 > mvhdBox.end) return null;

    const previousValue = view.getInt32(matrixBOffset, false);
    if (previousValue !== 0) {
        return {
            previousValue,
            newValue: previousValue,
            skipped: true,
        };
    }
    view.setInt32(matrixBOffset, 1, false);

    return {
        previousValue,
        newValue: 1,
    };
}

function downloadBuffer(data, filename, mimeType) {
    const blob =
        data instanceof Blob ? data : new Blob([data], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
    }, 1000);
}

function getStatusLabel(status) {
    return (
        {
            pending: "Pending",
            processing: "Processing",
            success: "Done",
            error: "Error",
        }[status] || status
    );
}

function renderFileList() {
    fileListEl.innerHTML = "";

    if (selectedFiles.length === 0) {
        fileListEl.style.display = "none";
        clearBtn.style.display = "none";
        return;
    }

    fileListEl.style.display = "flex";
    clearBtn.style.display = "inline-flex";

    let index = 0;
    for (const item of selectedFiles) {
        const removeIndex = index;
        const row = document.createElement("div");
        row.className = `file-item status-${item.status}`;

        const checkboxWrapper = document.createElement("label");
        checkboxWrapper.className = "custom-checkbox";
        const checkboxInput = document.createElement("input");
        checkboxInput.type = "checkbox";
        checkboxInput.checked = item.checked;
        if (
            currentFlowState !== "completed" ||
            item.status !== "success" ||
            !item.patchedBuffer
        ) {
            checkboxInput.disabled = true;
        }
        checkboxInput.addEventListener("change", () => {
            item.checked = checkboxInput.checked;
            updatePatchButton();
        });
        const checkboxSpan = document.createElement("span");
        checkboxSpan.className = "checkbox-mark";
        checkboxWrapper.appendChild(checkboxInput);
        checkboxWrapper.appendChild(checkboxSpan);
        row.appendChild(checkboxWrapper);

        const body = document.createElement("div");
        body.className = "file-item-body";

        const name = document.createElement("div");
        name.className = "file-item-name";
        name.textContent = item.name;

        const meta = document.createElement("div");
        meta.className = "file-item-meta";
        meta.textContent = formatFileSize(item.size);

        const fileProgressTrack = document.createElement("div");
        fileProgressTrack.className = "file-item-progress";
        const fileProgressBar = document.createElement("div");
        fileProgressBar.className = "file-item-progress-bar";
        fileProgressTrack.appendChild(fileProgressBar);

        body.appendChild(name);
        body.appendChild(meta);
        body.appendChild(fileProgressTrack);

        const icon = document.createElement("div");
        icon.className = "file-item-icon";
        const iconEl = document.createElement("i");
        iconEl.setAttribute("data-lucide", "file-video");
        icon.appendChild(iconEl);

        row.appendChild(icon);
        row.appendChild(body);

        const right = document.createElement("div");
        right.className = "file-item-right";

        const badge = document.createElement("span");
        badge.className = `file-badge badge-${item.status}`;
        badge.textContent = getStatusLabel(item.status);
        right.appendChild(badge);

        if (item.status === "pending") {
            const removeBtn = document.createElement("button");
            removeBtn.className = "file-remove-btn";
            const removeIcon = document.createElement("i");
            removeIcon.setAttribute("data-lucide", "x");
            removeBtn.appendChild(removeIcon);
            removeBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                removeFile(removeIndex);
            });
            right.appendChild(removeBtn);
        }

        row.appendChild(right);
        fileListEl.appendChild(row);
        index++;
    }

    createIcons({
        icons: ALL_ICONS,
    });
}

async function addFiles(fileList) {
    const filesArray = Array.from(fileList);
    if (currentFlowState === "completed") {
        selectedFiles = [];
        currentFlowState = "idle";
    }
    let totalHistorySize = 0;
    try {
        totalHistorySize = await getHistoryTotalSize();
    } catch (e) {}
    const totalQueueSize = selectedFiles
        .filter((f) => f.status !== "success")
        .reduce((sum, f) => sum + f.size, 0);
    let runningTotal = totalHistorySize + totalQueueSize;
    if (runningTotal >= 209715200) {
        logMessage(
            "Upload failed: Storage limit reached (200MB). Please delete one or more items from your history persistence storage to upload files again.",
            "error",
        );
        return;
    }
    let skipped = 0;
    let limitReached = false;
    for (const file of filesArray) {
        if (!isSupportedFile(file)) {
            skipped++;
            continue;
        }
        const isDupe = selectedFiles.some(
            (f) => f.name === file.name && f.size === file.size,
        );
        if (isDupe) {
            logMessage(
                `Duplicate file detected: "${file.name}". Skipping.`,
                "warning",
            );
            continue;
        }
        if (runningTotal + file.size > 209715200) {
            limitReached = true;
            break;
        }
        selectedFiles.push({
            file,
            name: file.name,
            size: file.size,
            status: "pending",
            patchedBuffer: null,
            outputName: null,
            mimeType: null,
            checked: true,
        });
        runningTotal += file.size;
    }
    if (limitReached) {
        logMessage(
            "Some files skipped: 200MB total storage limit reached. Clear your history persistence storage to upload more files.",
            "error",
        );
    }
    if (skipped > 0) logMessage(`${skipped} file(s) skipped.`, "warning");
    renderFileList();
    updatePatchButton();
    if (window.innerWidth <= 900) {
        setTimeout(() => {
            const controlBox = document.querySelector(".control-box");
            if (controlBox) {
                controlBox.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                });
            }
        }, 150);
    }
}

function removeFile(index) {
    selectedFiles.splice(index, 1);
    if (selectedFiles.length === 0) {
        currentFlowState = "idle";
    }
    renderFileList();
    updatePatchButton();
}

function updatePatchButton() {
    if (currentFlowState === "completed") {
        const checkedCount = selectedFiles.filter(
            (f) => f.status === "success" && f.checked && f.patchedBuffer,
        ).length;
        patchBtn.disabled = checkedCount === 0;
        const label = `Download Selected (${checkedCount})`;
        patchBtn.querySelector("span").textContent = label;
    } else {
        const pendingCount = selectedFiles.filter(
            (f) => f.status === "pending",
        ).length;
        patchBtn.disabled =
            pendingCount === 0 || currentFlowState === "patching";
        const label =
            pendingCount > 1
                ? `Patch Videos (${pendingCount})`
                : "Patch Videos";
        patchBtn.querySelector("span").textContent = label;
    }
}

function getVideoDurationAndResolution(file) {
    return new Promise((resolve) => {
        const video = document.createElement("video");
        video.preload = "metadata";
        video.muted = true;
        video.playsInline = true;
        const objectUrl = URL.createObjectURL(file);

        const timeoutId = setTimeout(() => {
            video.onloadedmetadata = null;
            video.onerror = null;
            video.src = "";
            video.load();
            URL.revokeObjectURL(objectUrl);
            resolve(null);
        }, 10000);

        video.src = objectUrl;
        video.onloadedmetadata = () => {
            clearTimeout(timeoutId);
            const result = {
                duration: video.duration,
                width: video.videoWidth,
                height: video.videoHeight,
            };
            video.onloadedmetadata = null;
            video.onerror = null;
            video.src = "";
            video.load();
            URL.revokeObjectURL(objectUrl);
            resolve(result);
        };
        video.onerror = () => {
            clearTimeout(timeoutId);
            video.onloadedmetadata = null;
            video.onerror = null;
            video.src = "";
            video.load();
            URL.revokeObjectURL(objectUrl);
            resolve(null);
        };
    });
}

let ffmpegInstance = null;
async function getFFmpeg() {
    if (ffmpegInstance) return ffmpegInstance;
    ffmpegInstance = new FFmpeg();
    logMessage("Loading high-performance video engine...", "info");
    const isMultiThread =
        typeof window.SharedArrayBuffer !== "undefined" &&
        window.crossOriginIsolated;
    const baseURL = isMultiThread
        ? "https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.6/dist/esm"
        : "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm";
    ffmpegInstance.on("progress", ({ progress }) => {
        setProgress(Math.round(progress * 100));
    });
    const loadConfig = {
        coreURL: await toBlobURL(
            `${baseURL}/ffmpeg-core.js`,
            "text/javascript",
        ),
        wasmURL: await toBlobURL(
            `${baseURL}/ffmpeg-core.wasm`,
            "application/wasm",
        ),
        classWorkerURL: await toBlobURL(
            "https://esm.sh/@ffmpeg/ffmpeg@0.12.15/es2022/dist/esm/worker.bundle.mjs",
            "text/javascript",
        ),
    };
    if (isMultiThread) {
        loadConfig.workerURL = await toBlobURL(
            `${baseURL}/ffmpeg-core.worker.js`,
            "text/javascript",
        );
    }
    await ffmpegInstance.load(loadConfig);
    logMessage("Video engine loaded successfully.", "success");
    return ffmpegInstance;
}

const CODEC_ENCODER_MAP = {
    h264: "libx264",
    avc: "libx264",
    hevc: "libx265",
    h265: "libx265",
    vp9: "libvpx-vp9",
    vp8: "libvpx",
    mpeg4: "mpeg4",
    av1: "libaom-av1",
};

function resolveInputExtension(file) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".mov")) return ".mov";
    if (lower.endsWith(".webm")) return ".webm";
    return ".mp4";
}

async function probeInputCodec(instance, inputName) {
    const logLines = [];
    const collector = ({ message }) => logLines.push(message.toLowerCase());
    instance.on("log", collector);
    try {
        await instance.exec(["-i", inputName]);
    } catch (_) {}
    instance.off("log", collector);

    for (const line of logLines) {
        const streamMatch = line.match(/\bvideo:\s*([a-z0-9]+)/);
        if (streamMatch) {
            const codec = streamMatch[1];
            if (CODEC_ENCODER_MAP[codec]) return codec;
        }
    }
    return null;
}

async function execWithEncoder(instance, args, encoder) {
    const logLines = [];
    const collector = ({ message }) => logLines.push(message.toLowerCase());
    instance.on("log", collector);
    try {
        await instance.exec(args);
        instance.off("log", collector);
        return true;
    } catch (err) {
        instance.off("log", collector);
        const failed = logLines.some(
            (l) =>
                l.includes("unknown encoder") ||
                l.includes(`encoder ${encoder} is not available`),
        );
        if (failed) return false;
        throw err;
    }
}

async function runVFI(file, width, height) {
    try {
        if (isCancelled) throw new Error("Cancelled");
        const instance = await getFFmpeg();
        if (isCancelled) throw new Error("Cancelled");
        const ext = resolveInputExtension(file);
        const inputName = `input${ext}`;
        const outputName = `output${ext}`;

        logMessage("Preparing video data streams...", "info");
        await instance.writeFile(inputName, await fetchFile(file));
        if (isCancelled) throw new Error("Cancelled");

        logMessage("Detecting input video codec...", "info");
        const detectedCodec = await probeInputCodec(instance, inputName);
        const targetEncoder = detectedCodec
            ? (CODEC_ENCODER_MAP[detectedCodec] ?? "libx264")
            : "libx264";
        logMessage(
            `Input codec: ${detectedCodec ?? "unknown"} -> encoder: ${targetEncoder}`,
            "info",
        );

        const isMultiThread =
            typeof window.SharedArrayBuffer !== "undefined" &&
            window.crossOriginIsolated;
        const threads = Math.min(navigator.hardwareConcurrency || 4, 8);
        if (!isMultiThread) {
            logMessage(
                "Notice: Single-threaded mode active. Enable HTTPS/cross-origin isolation for faster processing.",
                "warning",
            );
        }

        let filter =
            "mpdecimate,minterpolate=fps=60:mi_mode=mci:me_mode=bilat:me=epzs:search_param=4";
        if (width > height) {
            filter = `scale=-2:1080,${filter}`;
        } else {
            filter = `scale=1080:-2,${filter}`;
        }

        logMessage(
            "Interpolating video frames to 60fps... This may take up to a minute.",
            "info",
        );

        const buildArgs = (encoder) => [
            "-i",
            inputName,
            "-vf",
            filter,
            "-c:v",
            encoder,
            "-preset",
            "ultrafast",
            "-crf",
            "20",
            "-c:a",
            "copy",
            "-threads",
            String(threads),
            outputName,
        ];

        const succeeded = await execWithEncoder(
            instance,
            buildArgs(targetEncoder),
            targetEncoder,
        );

        if (!succeeded) {
            logMessage(
                `Encoder ${targetEncoder} not available in this build. Falling back to libx264.`,
                "warning",
            );
            await instance.exec(buildArgs("libx264"));
        }

        logMessage("Completed frame processing.", "success");
        const data = await instance.readFile(outputName);

        await instance.deleteFile(inputName);
        await instance.deleteFile(outputName);

        return data.buffer;
    } catch (err) {
        ffmpegInstance = null;
        throw err;
    }
}

async function patchSingleFile(item) {
    const enableInterpolation = document.getElementById("enableInterpolation");
    let workingBuffer;
    let workingBytes;
    let workingView;

    if (enableInterpolation?.checked) {
        logMessage("Starting VFI Engine for frame rate upgrade...", "info");
        if (isCancelled) throw new Error("Cancelled");
        const videoInfo = await getVideoDurationAndResolution(item.file);
        if (isCancelled) throw new Error("Cancelled");
        if (!videoInfo) {
            throw new Error("Could not parse video metadata.");
        }

        if (videoInfo.duration > 30) {
            throw new Error(
                `Video duration of ${Math.round(videoInfo.duration)}s exceeds the strict 30s limit.`,
            );
        }

        workingBuffer = await runVFI(
            item.file,
            videoInfo.width,
            videoInfo.height,
        );
        workingBytes = new Uint8Array(workingBuffer);
        workingView = new DataView(workingBuffer);
    } else {
        if (isCancelled) throw new Error("Cancelled");
        workingBuffer = await item.file.arrayBuffer();
        workingBytes = new Uint8Array(workingBuffer);
        workingView = new DataView(workingBuffer);
    }

    const mimeType = getMimeType(item.file);
    const outputName = getOutputFilename(item.file);

    let finalBuffer = workingBuffer;
    let finalBytes = workingBytes;
    let finalView = workingView;

    const elstResult = rebuildWithElstBypass(workingBytes, workingView);
    if (elstResult) {
        finalBuffer = elstResult.newBuffer;
        finalBytes = elstResult.newBytes;
        finalView = new DataView(finalBuffer);

        if (elstResult.replacedCount > 0 && elstResult.injectedCount > 0) {
            logMessage(
                `  [Pass 1/2] ZeroLoss Track Bypass: Replaced ${elstResult.replacedCount} and injected ${elstResult.injectedCount} elst atom(s).`,
                "success",
            );
        } else if (elstResult.replacedCount > 0) {
            logMessage(
                `  [Pass 1/2] ZeroLoss Track Bypass: Replaced ${elstResult.replacedCount} existing elst atom(s).`,
                "success",
            );
        } else {
            logMessage(
                `  [Pass 1/2] ZeroLoss Track Bypass: Injected ${elstResult.injectedCount} new elst atom(s).`,
                "success",
            );
        }
    } else {
        logMessage("  [Pass 1/2] ZeroLoss Track Bypass skipped.", "warning");
    }

    const quantumResult = patchMvhdMatrix(finalBytes, finalView);
    if (quantumResult && !quantumResult.skipped) {
        logMessage(
            `  [Pass 2/2] Quantum Matrix: Patched display matrix_b from ${quantumResult.previousValue} to ${quantumResult.newValue}.`,
            "success",
        );
    } else if (quantumResult?.skipped) {
        logMessage(
            "  [Pass 2/2] Quantum Matrix: Rotation matrix preserved (portrait video detected).",
            "info",
        );
    } else {
        logMessage("  [Pass 2/2] Quantum Matrix patch skipped.", "warning");
    }

    return { finalBuffer, outputName, mimeType };
}

async function downloadSelectedFiles() {
    const selectedToDownload = selectedFiles.filter(
        (f) => f.status === "success" && f.checked && f.patchedBuffer,
    );
    if (selectedToDownload.length === 0) return;

    logMessage(
        `Starting download for ${selectedToDownload.length} file(s)...`,
        "info",
    );

    for (let i = 0; i < selectedToDownload.length; i++) {
        const item = selectedToDownload[i];
        logMessage(`  Downloading: ${item.outputName}`, "success");
        downloadBuffer(item.patchedBuffer, item.outputName, item.mimeType);
        item.patchedBuffer = null;
        item.file = null;
        item.checked = false;

        if (i < selectedToDownload.length - 1) {
            await new Promise((r) => setTimeout(r, 300));
        }
    }

    logMessage("All selected downloads triggered successfully.", "success");
    renderFileList();
    updatePatchButton();
}

dropZone.addEventListener("click", () => {
    fileInput.click();
});

fileInput.addEventListener("change", (event) => {
    if (event.target.files.length > 0) addFiles(event.target.files);
    fileInput.value = "";
});

clearBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (currentFlowState === "patching") {
        isCancelled = true;
        logMessage("Cancelling active interpolation progress...", "warning");
        if (ffmpegInstance) {
            try {
                ffmpegInstance.terminate();
            } catch (err) {}
            ffmpegInstance = null;
        }
        return;
    }
    selectedFiles = [];
    currentFlowState = "idle";
    hideProgress();
    clearLog();
    renderFileList();
    updatePatchButton();
});

dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("drag-over");
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
});

dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag-over");
    if (event.dataTransfer.files.length > 0) addFiles(event.dataTransfer.files);
});

patchBtn.addEventListener("click", async () => {
    if (currentFlowState === "completed") {
        await downloadSelectedFiles();
        return;
    }

    const pendingItems = selectedFiles.filter((f) => f.status === "pending");
    if (pendingItems.length === 0) return;

    currentFlowState = "patching";
    clearLog();
    patchBtn.disabled = true;
    clearBtn.innerText = "Cancel";
    clearBtn.disabled = false;
    showProgress();

    isCancelled = false;
    let successCount = 0;

    for (let i = 0; i < pendingItems.length; i++) {
        if (isCancelled) {
            break;
        }
        const item = pendingItems[i];
        setProgress(Math.round((i / pendingItems.length) * 100));

        item.status = "processing";
        renderFileList();
        logMessage(`[${i + 1}/${pendingItems.length}] ${item.name}`, "info");

        try {
            const result = await patchSingleFile(item);
            if (isCancelled) {
                item.status = "pending";
                break;
            }
            item.status = "success";
            item.patchedBuffer = result.finalBuffer;
            item.outputName = result.outputName;
            item.mimeType = result.mimeType;
            item.checked = true;
            successCount++;

            if (result.finalBuffer.byteLength <= 209715200) {
                try {
                    const thumbnail = await captureVideoFrame(item.file);
                    const blob = new Blob([result.finalBuffer], {
                        type: result.mimeType,
                    });
                    await saveRecord({
                        id: self.crypto.randomUUID(),
                        name: result.outputName,
                        size: result.finalBuffer.byteLength,
                        timestamp: Date.now(),
                        thumbnail,
                        blob,
                        mimeType: result.mimeType,
                    });
                    await renderHistoryList();
                } catch (dbError) {
                    logMessage(
                        `  Database save skipped: ${dbError.message}`,
                        "warning",
                    );
                }
            }

            if (i < pendingItems.length - 1) {
                if (isCancelled) {
                    break;
                }
                await new Promise((r) => setTimeout(r, 600));
                if (isCancelled) {
                    break;
                }
            }
        } catch (error) {
            if (isCancelled) {
                item.status = "pending";
                break;
            }
            item.status = "error";
            item.checked = false;
            logMessage(`  Error: ${error.message}`, "error");
        }

        renderFileList();
    }

    if (isCancelled) {
        for (const item of pendingItems) {
            if (item.status === "processing" || item.status === "pending") {
                item.status = "pending";
            }
        }
        currentFlowState = "idle";
        setProgress(0);
        hideProgress();
        clearBtn.innerText = "Clear";
        logMessage("Interpolation progress cancelled by user.", "warning");
        renderFileList();
        updatePatchButton();
        return;
    }

    currentFlowState = "completed";
    setProgress(100);
    logMessage(
        `Done. ${successCount}/${pendingItems.length} file(s) patched successfully.`,
        successCount === pendingItems.length ? "success" : "warning",
    );
    hideProgress();

    clearBtn.innerText = "Clear";
    clearBtn.disabled = false;
    renderFileList();
    updatePatchButton();
});

async function renderHistoryList() {
    const records = await getAllRecords();
    historyList.innerHTML = "";
    historyBadge.textContent = records.length;

    if (records.length === 0) {
        historyList.innerHTML = `<div class="history-item-empty" style="font-size: 10px; color: #657c6a; text-align: center; padding: 12px 0; font-family: 'JetBrains Mono', monospace;">No history records found</div>`;
        return;
    }

    for (const record of records) {
        const item = document.createElement("div");
        item.className = "history-item";

        const thumb = document.createElement("div");
        thumb.className = "history-thumbnail";
        if (record.thumbnail) {
            const img = document.createElement("img");
            img.src = record.thumbnail;
            img.alt = "preview";
            thumb.appendChild(img);
        } else {
            const icon = document.createElement("i");
            icon.setAttribute("data-lucide", "file-video");
            thumb.appendChild(icon);
        }

        const body = document.createElement("div");
        body.className = "history-item-body";

        const name = document.createElement("div");
        name.className = "history-item-name";
        name.textContent = record.name;

        const meta = document.createElement("div");
        meta.className = "history-item-meta";
        meta.textContent = `${formatFileSize(record.size)} • ${new Date(record.timestamp).toLocaleTimeString()}`;

        body.appendChild(name);
        body.appendChild(meta);

        const actions = document.createElement("div");
        actions.className = "history-item-actions";

        const dlBtn = document.createElement("button");
        dlBtn.className = "history-btn";
        const dlIcon = document.createElement("i");
        dlIcon.setAttribute("data-lucide", "download");
        dlBtn.appendChild(dlIcon);
        dlBtn.addEventListener("click", () => {
            downloadBuffer(
                record.blob || record.buffer,
                record.name,
                record.mimeType || "video/mp4",
            );
        });

        const delBtn = document.createElement("button");
        delBtn.className = "history-btn history-btn-delete";
        const delIcon = document.createElement("i");
        delIcon.setAttribute("data-lucide", "trash-2");
        delBtn.appendChild(delIcon);
        delBtn.addEventListener("click", async () => {
            await deleteRecord(record.id);
            await renderHistoryList();
        });

        actions.appendChild(dlBtn);
        actions.appendChild(delBtn);

        item.appendChild(thumb);
        item.appendChild(body);
        item.appendChild(actions);

        historyList.appendChild(item);
    }

    createIcons({
        icons: ALL_ICONS,
    });
}

historyHeader.addEventListener("click", () => {
    const container = historyHeader.parentElement;
    container.classList.toggle("collapsed");
});

clearHistoryBtn.addEventListener("click", async () => {
    await clearAllRecords();
    await renderHistoryList();
});

const enableInterpolation = document.getElementById("enableInterpolation");
const vfiModal = document.getElementById("vfiModal");
const closeVfiModalBtn = document.getElementById("closeVfiModalBtn");
const cancelVfiBtn = document.getElementById("cancelVfiBtn");
const confirmVfiBtn = document.getElementById("confirmVfiBtn");

if (enableInterpolation && vfiModal) {
    enableInterpolation.addEventListener("change", () => {
        if (enableInterpolation.checked) {
            vfiModal.classList.add("active");
        }
    });

    const closeModal = () => vfiModal.classList.remove("active");

    const cancelModal = () => {
        enableInterpolation.checked = false;
        closeModal();
    };

    closeVfiModalBtn?.addEventListener("click", cancelModal);
    cancelVfiBtn?.addEventListener("click", cancelModal);
    confirmVfiBtn?.addEventListener("click", closeModal);

    vfiModal.addEventListener("click", (e) => {
        if (e.target === vfiModal) cancelModal();
    });
}

initializeApp();
