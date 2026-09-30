const apiBaseUrl = "http://127.0.0.1:8000";
const token = localStorage.getItem("student-hub-token");
const foldersElement = document.getElementById("folderList");
const notePageGrid = document.getElementById("notePageGrid");
const emptyState = document.getElementById("hubEmptyState");
const folderCreateForm = document.getElementById("folderCreateForm");
const noteEditorDialog = document.getElementById("noteEditorDialog");
const noteEditorForm = document.getElementById("noteEditorForm");
const noteFolderSelect = document.getElementById("noteFolder");
const noteCanvas = document.getElementById("noteCanvas");
const textBoxLayer = document.getElementById("textBoxLayer");
const canvasContext = noteCanvas.getContext("2d");
const editorWorkspace = document.getElementById("editorWorkspace");
const weekTasksList = document.getElementById("weekTasksList");

let folders = [];
let notes = [];
let weekCalendarTasks = [];
let selectedFolderFilter = "all";
let selectedNote = null;
let drawings = [];
let activeDrawing = null;
let currentMode = "select";

async function apiRequest(path, options = {}) {
    if (!token) throw new Error("Please log in to use Class Hub.");
    const response = await fetch(`${apiBaseUrl}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
        },
    });
    if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.detail || "Unable to save your changes.");
    }
    return response.status === 204 ? null : response.json();
}

function setFolderFilter(folderId) {
    selectedFolderFilter = folderId;
    renderFolders();
    renderNotes();
}

function renderFolders() {
    foldersElement.replaceChildren();
    folders.forEach((folder) => {
        const row = document.createElement("div");
        row.className = "folderRow";
        const folderButton = document.createElement("button");
        folderButton.type = "button";
        folderButton.className = `folderButton${selectedFolderFilter === String(folder.id) ? " isSelected" : ""}`;
        folderButton.dataset.folderDrop = String(folder.id);
        folderButton.setAttribute("aria-label", `${folder.class_name}, ${folder.subject} folder. Drop note pages here.`);
        const glyph = document.createElement("span");
        glyph.className = "folderGlyph";
        glyph.setAttribute("aria-hidden", "true");
        glyph.textContent = "▰";
        const names = document.createElement("span");
        names.className = "folderNames";
        const className = document.createElement("strong");
        className.textContent = folder.class_name;
        const subject = document.createElement("small");
        subject.textContent = folder.subject;
        names.append(className, subject);
        const count = document.createElement("span");
        count.className = "folderPageCount";
        count.textContent = String(notes.filter((note) => note.folder_id === folder.id).length);
        folderButton.append(glyph, names, count);
        folderButton.addEventListener("click", () => setFolderFilter(String(folder.id)));
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "folderMore";
        deleteButton.textContent = "×";
        deleteButton.setAttribute("aria-label", `Delete ${folder.class_name} folder`);
        deleteButton.title = "Delete folder and move its pages to unfiled";
        deleteButton.addEventListener("click", async (event) => {
            event.stopPropagation();
            if (!window.confirm(`Delete ${folder.class_name} · ${folder.subject}? Its note pages will be kept as unfiled pages.`)) return;
            try {
                await apiRequest(`/class-folders/${folder.id}`, { method: "DELETE" });
                folders = folders.filter((candidate) => candidate.id !== folder.id);
                notes = notes.map((note) => note.folder_id === folder.id ? { ...note, folder_id: null } : note);
                if (selectedFolderFilter === String(folder.id)) selectedFolderFilter = "all";
                render();
            } catch (error) {
                document.getElementById("folderError").textContent = error.message;
                folderCreateForm.hidden = false;
            }
        });
        row.append(folderButton, deleteButton);
        foldersElement.appendChild(row);
    });

    const allFilter = document.querySelector('[data-folder-filter="all"]');
    allFilter.classList.toggle("isSelected", selectedFolderFilter === "all");
    document.getElementById("allPageCount").textContent = String(notes.length);
    const unfiledDrop = document.getElementById("unfiledDrop");
    unfiledDrop.classList.toggle("isSelected", selectedFolderFilter === "unfiled");

    document.querySelectorAll("[data-folder-drop]").forEach((target) => {
        target.addEventListener("dragover", (event) => {
            if (!Array.from(event.dataTransfer.types).includes("text/note-page-id")) return;
            event.preventDefault();
            target.classList.add("isDropTarget");
            event.dataTransfer.dropEffect = "move";
        });
        target.addEventListener("dragleave", (event) => {
            if (!target.contains(event.relatedTarget)) target.classList.remove("isDropTarget");
        });
        target.addEventListener("drop", async (event) => {
            event.preventDefault();
            target.classList.remove("isDropTarget");
            const noteId = Number(event.dataTransfer.getData("text/note-page-id"));
            const folderId = target.dataset.folderDrop ? Number(target.dataset.folderDrop) : null;
            const note = notes.find((candidate) => candidate.id === noteId);
            if (note && note.folder_id !== folderId) await moveNote(note, folderId);
        });
    });
}

function getVisibleNotes() {
    const visible = selectedFolderFilter === "all"
        ? [...notes]
        : notes.filter((note) => String(note.folder_id) === selectedFolderFilter);
    const folderName = (folderId) => {
        const folder = folders.find((candidate) => candidate.id === folderId);
        return folder ? `${folder.class_name} ${folder.subject}` : "Unfiled";
    };
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return visible.sort((left, right) => {
        const folderOrder = collator.compare(folderName(left.folder_id), folderName(right.folder_id));
        return folderOrder || collator.compare(left.sequence, right.sequence) || collator.compare(left.title, right.title);
    });
}

function renderNotes() {
    notePageGrid.replaceChildren();
    const visibleNotes = getVisibleNotes();
    const activeFolder = folders.find((folder) => String(folder.id) === selectedFolderFilter);
    document.getElementById("listHeading").textContent = activeFolder
        ? `${activeFolder.class_name} · ${activeFolder.subject}`
        : selectedFolderFilter === "all" ? "All note pages" : "Unfiled pages";
    emptyState.hidden = visibleNotes.length > 0;
    notePageGrid.hidden = visibleNotes.length === 0;
    visibleNotes.forEach((note) => {
        const card = document.createElement("article");
        card.className = "noteCard";
        card.draggable = true;
        card.tabIndex = 0;
        card.setAttribute("aria-label", `${note.sequence}, ${note.title}. Drag to move to a class folder.`);
        card.addEventListener("dragstart", (event) => {
            card.classList.add("isDragging");
            event.dataTransfer.setData("text/note-page-id", String(note.id));
            event.dataTransfer.effectAllowed = "move";
        });
        card.addEventListener("dragend", () => card.classList.remove("isDragging"));
        card.addEventListener("click", () => openNoteEditor(note));
        card.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openNoteEditor(note);
            }
        });

        const top = document.createElement("div");
        top.className = "noteCardTop";
        const sequence = document.createElement("span");
        sequence.className = "sequenceBadge";
        sequence.textContent = note.sequence;
        const menu = document.createElement("span");
        menu.className = "drawingCount";
        menu.textContent = note.drawings.length ? `✎ ${note.drawings.length}` : "";
        top.append(sequence, menu);
        const title = document.createElement("h3");
        title.textContent = note.title;
        const folder = folders.find((candidate) => candidate.id === note.folder_id);
        const folderLabel = document.createElement("p");
        folderLabel.className = "noteCardFolder";
        folderLabel.textContent = folder ? `${folder.class_name} · ${folder.subject}` : "Unfiled";
        const preview = document.createElement("p");
        preview.className = "notePreview";
        const textPreview = note.drawings.filter((element) => element.kind === "text").map((element) => element.text).join(" ");
        preview.textContent = textPreview || note.content || (note.drawings.length ? "Drawing and diagram notes" : "An empty note page");
        const footer = document.createElement("div");
        footer.className = "noteCardFooter";
        footer.textContent = "Open page";
        const dragTip = document.createElement("span");
        dragTip.textContent = "⠿ Move";
        footer.appendChild(dragTip);
        card.append(top, title, folderLabel, preview, footer);
        notePageGrid.appendChild(card);
    });
}

function render() {
    renderFolders();
    renderNotes();
}

function toLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function formatCalendarTime(time) {
    if (!time) return "";
    const [hour, minute] = time.split(":").map(Number);
    return new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderWeekTasks() {
    const tasks = weekCalendarTasks
        .filter((item) => item.kind !== "event")
        .sort((left, right) => {
            if (left.completed !== right.completed) return Number(left.completed) - Number(right.completed);
            return left.date.localeCompare(right.date)
                || (left.start_time || "").localeCompare(right.start_time || "")
                || left.id - right.id;
        });
    weekTasksList.replaceChildren();
    document.getElementById("weekTasksCount").textContent = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
    document.getElementById("weekTasksEmpty").hidden = tasks.length > 0;

    tasks.forEach((task) => {
        const item = document.createElement("li");
        item.className = `weekTaskItem${task.completed ? " isCompleted" : ""}`;
        const details = document.createElement("div");
        details.className = "weekTaskDetails";
        const title = document.createElement("strong");
        title.textContent = task.title;
        const metadata = document.createElement("span");
        const taskDate = new Date(`${task.date}T12:00:00`);
        const dateLabel = taskDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        const timeRange = [formatCalendarTime(task.start_time), formatCalendarTime(task.end_time)].filter(Boolean).join(" – ");
        metadata.textContent = [dateLabel, task.kind, timeRange].filter(Boolean).join(" · ");
        details.append(title, metadata);
        item.appendChild(details);
        weekTasksList.appendChild(item);
    });
}

async function loadWeekTasks() {
    const today = new Date();
    const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
    const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
    const status = document.getElementById("weekTasksStatus");
    status.textContent = "";
    try {
        weekCalendarTasks = await apiRequest(
            `/calendarTasks?start_date=${toLocalDateString(weekStart)}&end_date=${toLocalDateString(weekEnd)}`,
        );
        renderWeekTasks();
    } catch (error) {
        weekCalendarTasks = [];
        renderWeekTasks();
        status.textContent = error.message;
    }
}

async function loadHub() {
    try {
        [folders, notes] = await Promise.all([
            apiRequest("/class-folders"),
            apiRequest("/class-notes"),
        ]);
        render();
    } catch (error) {
        emptyState.hidden = false;
        emptyState.querySelector("h3").textContent = "Unable to load Class Hub";
        emptyState.querySelector("p").textContent = error.message;
        document.getElementById("emptyCreatePage").hidden = true;
    }
}

window.addEventListener("focus", loadWeekTasks);
document.querySelector('[data-folder-filter="all"]').addEventListener("click", () => setFolderFilter("all"));
document.getElementById("unfiledDrop").addEventListener("click", () => setFolderFilter("unfiled"));

document.getElementById("showFolderForm").addEventListener("click", () => {
    folderCreateForm.hidden = !folderCreateForm.hidden;
    if (!folderCreateForm.hidden) folderCreateForm.querySelector('input[name="class_name"]').focus();
});
document.getElementById("cancelFolderForm").addEventListener("click", () => {
    folderCreateForm.reset();
    document.getElementById("folderError").textContent = "";
    folderCreateForm.hidden = true;
});
folderCreateForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    document.getElementById("folderError").textContent = "";
    const formData = new FormData(folderCreateForm);
    try {
        const folder = await apiRequest("/class-folders", {
            method: "POST",
            body: JSON.stringify({
                class_name: formData.get("class_name"),
                subject: formData.get("subject"),
            }),
        });
        folders.push(folder);
        selectedFolderFilter = String(folder.id);
        folderCreateForm.reset();
        folderCreateForm.hidden = true;
        render();
    } catch (error) {
        document.getElementById("folderError").textContent = error.message;
    }
});

function populateFolderSelect(selectedId = null) {
    noteFolderSelect.replaceChildren();
    const unfiled = document.createElement("option");
    unfiled.value = "";
    unfiled.textContent = "Unfiled";
    noteFolderSelect.appendChild(unfiled);
    folders.filter((folder) => folder.active).forEach((folder) => {
        const option = document.createElement("option");
        option.value = String(folder.id);
        option.textContent = `${folder.class_name} · ${folder.subject}`;
        noteFolderSelect.appendChild(option);
    });
    noteFolderSelect.value = selectedId ? String(selectedId) : "";
}

function getNoteDrawings(note) {
    const noteDrawings = structuredClone(note.drawings);
    if (note.content?.trim() && !noteDrawings.some((element) => element.kind === "text")) {
        noteDrawings.push({
            kind: "text",
            color: "#202c3d",
            line_style: "solid",
            points: [{ x: 0.075, y: 0.04 }],
            text: note.content,
        });
    }
    return noteDrawings;
}

function openNoteEditor(note = null) {
    selectedNote = note;
    drawings = note ? getNoteDrawings(note) : [];
    noteEditorForm.reset();
    document.getElementById("editorError").textContent = "";
    document.getElementById("saveStatus").textContent = "Changes are saved when you select Save page.";
    document.getElementById("noteEditorHeading").textContent = note ? "Edit note page" : "New note page";
    document.getElementById("noteTitle").value = note?.title || "";
    document.getElementById("noteSequence").value = note?.sequence || nextSequence();
    populateFolderSelect(note?.folder_id || (selectedFolderFilter !== "all" && selectedFolderFilter !== "unfiled" ? selectedFolderFilter : null));
    document.getElementById("deleteNoteButton").hidden = !note;
    setEditorMode("select");
    noteEditorDialog.showModal();
    resizeCanvas();
    document.getElementById("noteTitle").focus();
}

function nextSequence() {
    const folderNotes = selectedFolderFilter === "all" || selectedFolderFilter === "unfiled"
        ? notes
        : notes.filter((note) => String(note.folder_id) === selectedFolderFilter);
    const usedNumbers = folderNotes.map((note) => Number(note.sequence)).filter(Number.isInteger);
    return String(usedNumbers.length ? Math.max(...usedNumbers) + 1 : 1);
}

document.getElementById("createPageButton").addEventListener("click", () => openNoteEditor());
document.getElementById("emptyCreatePage").addEventListener("click", () => openNoteEditor());

async function moveNote(note, folderId) {
    try {
        const updated = await apiRequest(`/class-notes/${note.id}`, {
            method: "PATCH",
            body: JSON.stringify({
                folder_id: folderId,
                title: note.title,
                sequence: note.sequence,
                content: "",
                drawings: getNoteDrawings(note),
            }),
        });
        notes = notes.map((candidate) => candidate.id === updated.id ? updated : candidate);
        render();
    } catch (error) {
        window.alert(error.message);
    }
}

function setEditorMode(mode) {
    currentMode = mode;
    editorWorkspace.dataset.mode = mode;
    document.querySelectorAll("[data-mode]").forEach((button) => {
        const active = button.dataset.mode === mode;
        button.classList.toggle("isActive", active);
        button.setAttribute("aria-pressed", String(active));
    });
}

document.querySelectorAll("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => setEditorMode(button.dataset.mode));
});

function resizeCanvas() {
    const rect = noteCanvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const pixelRatio = window.devicePixelRatio || 1;
    noteCanvas.width = Math.round(rect.width * pixelRatio);
    noteCanvas.height = Math.round(rect.height * pixelRatio);
    canvasContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    renderDrawings();
}

function drawingPoint(event) {
    const rect = noteCanvas.getBoundingClientRect();
    return {
        x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
}

function drawElement(element) {
    if (element.kind === "text") return;
    const width = noteCanvas.clientWidth;
    const height = noteCanvas.clientHeight;
    const points = element.points.map((point) => ({ x: point.x * width, y: point.y * height }));
    if (!points.length) return;
    const [first, last] = [points[0], points[points.length - 1]];
    canvasContext.save();
    canvasContext.strokeStyle = element.color;
    canvasContext.fillStyle = element.color;
    canvasContext.lineWidth = 2.5;
    canvasContext.lineCap = element.line_style === "dotted" ? "round" : "round";
    canvasContext.lineJoin = "round";
    canvasContext.setLineDash(element.line_style === "dashed" ? [9, 6] : element.line_style === "dotted" ? [1, 6] : []);
    canvasContext.beginPath();

    if (element.kind === "pen") {
        canvasContext.moveTo(first.x, first.y);
        points.slice(1).forEach((point) => canvasContext.lineTo(point.x, point.y));
        if (points.length === 1) canvasContext.lineTo(first.x + 0.1, first.y + 0.1);
        canvasContext.stroke();
    } else if (element.kind === "rectangle") {
        canvasContext.rect(first.x, first.y, last.x - first.x, last.y - first.y);
        canvasContext.stroke();
    } else if (element.kind === "ellipse") {
        const rx = Math.abs(last.x - first.x) / 2;
        const ry = Math.abs(last.y - first.y) / 2;
        if (rx > 0 && ry > 0) {
            canvasContext.ellipse((first.x + last.x) / 2, (first.y + last.y) / 2, rx, ry, 0, 0, Math.PI * 2);
            canvasContext.stroke();
        }
    } else {
        canvasContext.moveTo(first.x, first.y);
        canvasContext.lineTo(last.x, last.y);
        canvasContext.stroke();
        if (element.kind === "arrow") {
            const angle = Math.atan2(last.y - first.y, last.x - first.x);
            const headLength = 12;
            canvasContext.setLineDash([]);
            canvasContext.beginPath();
            canvasContext.moveTo(last.x, last.y);
            canvasContext.lineTo(last.x - headLength * Math.cos(angle - Math.PI / 6), last.y - headLength * Math.sin(angle - Math.PI / 6));
            canvasContext.moveTo(last.x, last.y);
            canvasContext.lineTo(last.x - headLength * Math.cos(angle + Math.PI / 6), last.y - headLength * Math.sin(angle + Math.PI / 6));
            canvasContext.stroke();
        }
    }
    canvasContext.restore();
}

function renderDrawings() {
    if (!canvasContext || !noteCanvas.clientWidth || !noteCanvas.clientHeight) return;
    canvasContext.clearRect(0, 0, noteCanvas.clientWidth, noteCanvas.clientHeight);
    drawings.filter((element) => element.kind !== "text").forEach(drawElement);
    if (activeDrawing) drawElement(activeDrawing);
    renderTextBoxes();
}

function renderTextBoxes() {
    textBoxLayer.replaceChildren();
    drawings.forEach((element, index) => {
        if (element.kind !== "text") return;
        const point = element.points[0];
        const box = document.createElement("div");
        box.className = "placedTextBox";
        box.dataset.drawingIndex = String(index);
        const textBox = document.createElement("textarea");
        textBox.className = "noteTextBox";
        textBox.setAttribute("aria-label", "Note text box. Click to edit.");
        textBox.placeholder = "Type here…";
        textBox.maxLength = 4000;
        textBox.value = element.text || "";
        const width = element.width ? element.width * noteCanvas.clientWidth : Math.min(220, noteCanvas.clientWidth - point.x * noteCanvas.clientWidth);
        const height = element.height ? element.height * noteCanvas.clientHeight : Math.min(72, noteCanvas.clientHeight - point.y * noteCanvas.clientHeight);
        box.style.left = `${point.x * 100}%`;
        box.style.top = `${point.y * 100}%`;
        box.style.width = `${Math.max(120, width)}px`;
        box.style.height = `${Math.max(54, height)}px`;
        textBox.style.fontSize = `${14 * (element.font_scale || 1)}px`;
        textBox.addEventListener("input", () => {
            drawings[index].text = textBox.value;
        });
        box.appendChild(textBox);
        ["nw", "ne", "sw", "se"].forEach((corner) => {
            const handle = document.createElement("button");
            handle.type = "button";
            handle.className = "textBoxResizeHandle";
            handle.dataset.corner = corner;
            handle.setAttribute("aria-label", `Resize text box from ${corner.includes("n") ? "top" : "bottom"} ${corner.includes("w") ? "left" : "right"} corner`);
            handle.addEventListener("pointerdown", (event) => startTextBoxResize(event, index, corner));
            box.appendChild(handle);
        });
        textBoxLayer.appendChild(box);
    });
}

function startTextBoxResize(event, index, corner) {
    event.preventDefault();
    event.stopPropagation();
    const box = event.currentTarget.parentElement;
    const workspaceRect = editorWorkspace.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const start = {
        x: event.clientX,
        y: event.clientY,
        left: boxRect.left - workspaceRect.left,
        top: boxRect.top - workspaceRect.top,
        width: boxRect.width,
        height: boxRect.height,
        fontScale: drawings[index].font_scale || 1,
    };
    const west = corner.includes("w");
    const north = corner.includes("n");
    const minWidth = Math.min(120, workspaceRect.width);
    const minHeight = Math.min(54, workspaceRect.height);
    const onMove = (moveEvent) => {
        const maxWidth = west ? start.left + start.width : workspaceRect.width - start.left;
        const maxHeight = north ? start.top + start.height : workspaceRect.height - start.top;
        const nextWidth = Math.min(Math.max(minWidth, start.width + (west ? -1 : 1) * (moveEvent.clientX - start.x)), maxWidth);
        const nextHeight = Math.min(Math.max(minHeight, start.height + (north ? -1 : 1) * (moveEvent.clientY - start.y)), maxHeight);
        const left = west ? start.left + start.width - nextWidth : start.left;
        const top = north ? start.top + start.height - nextHeight : start.top;
        const scale = Math.min(4, Math.max(0.8, start.fontScale * Math.sqrt((nextWidth / start.width) * (nextHeight / start.height))));

        drawings[index].points[0] = {
            x: left / workspaceRect.width,
            y: top / workspaceRect.height,
        };
        drawings[index].width = nextWidth / workspaceRect.width;
        drawings[index].height = nextHeight / workspaceRect.height;
        drawings[index].font_scale = scale;
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${nextWidth}px`;
        box.style.height = `${nextHeight}px`;
        box.querySelector(".noteTextBox").style.fontSize = `${14 * scale}px`;
    };
    const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
}

editorWorkspace.addEventListener("click", (event) => {
    if (currentMode !== "text" || event.target !== editorWorkspace) return;
    if (drawings.length >= 300) {
        document.getElementById("editorError").textContent = "This page has reached the 300-item limit.";
        return;
    }
    const rect = editorWorkspace.getBoundingClientRect();
    const x = Math.min(Math.max(0, 1 - 220 / rect.width), Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(Math.max(0, 1 - 72 / rect.height), Math.max(0, (event.clientY - rect.top) / rect.height));
    drawings.push({
        kind: "text",
        color: "#202c3d",
        line_style: "solid",
        points: [{ x, y }],
        text: "",
        width: Math.min(220, rect.width - x * rect.width) / rect.width,
        height: Math.min(72, rect.height - y * rect.height) / rect.height,
        font_scale: 1,
    });
    renderTextBoxes();
    textBoxLayer.lastElementChild.focus();
});

noteCanvas.addEventListener("pointerdown", (event) => {
    if (currentMode !== "draw") return;
    event.preventDefault();
    noteCanvas.setPointerCapture(event.pointerId);
    const kind = document.getElementById("drawingTool").value;
    const point = drawingPoint(event);
    activeDrawing = {
        kind,
        color: document.getElementById("drawingColor").value,
        line_style: document.getElementById("drawingStyle").value,
        points: [point],
    };
    renderDrawings();
});
noteCanvas.addEventListener("pointermove", (event) => {
    if (!activeDrawing) return;
    const point = drawingPoint(event);
    if (activeDrawing.kind === "pen") activeDrawing.points.push(point);
    else if (activeDrawing.points.length === 1) activeDrawing.points.push(point);
    else activeDrawing.points[1] = point;
    renderDrawings();
});
function finishDrawing() {
    if (!activeDrawing) return;
    if (activeDrawing.points.length === 1 && activeDrawing.kind !== "pen") activeDrawing.points.push(activeDrawing.points[0]);
    if (drawings.length < 300) drawings.push(activeDrawing);
    else document.getElementById("editorError").textContent = "This page has reached the 300-drawing limit.";
    activeDrawing = null;
    renderDrawings();
}
noteCanvas.addEventListener("pointerup", finishDrawing);
noteCanvas.addEventListener("pointercancel", finishDrawing);
document.getElementById("undoDrawing").addEventListener("click", () => {
    drawings.pop();
    renderDrawings();
});
document.getElementById("clearDrawings").addEventListener("click", () => {
    if (!drawings.length || !window.confirm("Clear all drawings and text boxes from this page?")) return;
    drawings = [];
    renderDrawings();
});
new ResizeObserver(resizeCanvas).observe(editorWorkspace);
window.addEventListener("resize", resizeCanvas);

noteEditorForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    document.getElementById("editorError").textContent = "";
    document.getElementById("saveStatus").textContent = "Saving…";
    const payload = {
        folder_id: noteFolderSelect.value ? Number(noteFolderSelect.value) : null,
        title: document.getElementById("noteTitle").value.trim(),
        sequence: document.getElementById("noteSequence").value.trim(),
        content: "",
        drawings: drawings.filter((element) => element.kind !== "text" || element.text?.trim()),
    };
    const saveButton = document.getElementById("saveNoteButton");
    saveButton.disabled = true;
    try {
        const saved = await apiRequest(selectedNote ? `/class-notes/${selectedNote.id}` : "/class-notes", {
            method: selectedNote ? "PATCH" : "POST",
            body: JSON.stringify(payload),
        });
        if (selectedNote) notes = notes.map((note) => note.id === saved.id ? saved : note);
        else notes.push(saved);
        noteEditorDialog.close();
        render();
    } catch (error) {
        document.getElementById("editorError").textContent = error.message;
        document.getElementById("saveStatus").textContent = "Your changes have not been saved.";
    } finally {
        saveButton.disabled = false;
    }
});

async function deleteSelectedNote() {
    if (!selectedNote || !window.confirm(`Delete "${selectedNote.title}"? This cannot be undone.`)) return;
    try {
        await apiRequest(`/class-notes/${selectedNote.id}`, { method: "DELETE" });
        notes = notes.filter((note) => note.id !== selectedNote.id);
        noteEditorDialog.close();
        render();
    } catch (error) {
        document.getElementById("editorError").textContent = error.message;
    }
}
document.getElementById("deleteNoteButton").addEventListener("click", deleteSelectedNote);
document.getElementById("closeNoteEditor").addEventListener("click", () => noteEditorDialog.close());
document.getElementById("cancelNoteEditor").addEventListener("click", () => noteEditorDialog.close());
noteEditorDialog.addEventListener("click", (event) => {
    if (event.target === noteEditorDialog) noteEditorDialog.close();
});

loadHub();
loadWeekTasks();
