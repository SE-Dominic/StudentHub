const taskList = document.getElementById("taskList");
const taskInput = document.getElementById("taskInput");
const taskForm = document.getElementById("taskForm");
const emptyState = document.getElementById("emptyState");
const taskCount = document.getElementById("taskCount");
const progressBar = document.getElementById("progressBar");
const progressPercent = document.getElementById("progressPercent");
const progressSummary = document.getElementById("progressSummary");
const progressMessage = document.getElementById("progressMessage");
const apiBaseUrl = "http://127.0.0.1:8000";
const token = localStorage.getItem("student-hub-token");
const calendarGrid = document.getElementById("calendarGrid");
const calendarStatus = document.getElementById("calendarStatus");
const dayDialog = document.getElementById("dayDialog");
const calendarTaskForm = document.getElementById("calendarTaskForm");
const calendarTaskList = document.getElementById("calendarTaskList");
const calendarFormError = document.getElementById("calendarFormError");
const chatPanel = document.getElementById("chatPanel");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatMessages = document.getElementById("chatMessages");

let tasks = [];
let calendarTasks = [];
let selectedDate = "";
let displayedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let chatHistory = [];

function authenticatedRequest(path, options = {}) {
    if (!token) {
        throw new Error("Please log in before managing your calendar.");
    }
    return fetch(`${apiBaseUrl}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
        },
    }).then(async (response) => {
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.detail || "Unable to save your changes.");
        }
        return response.status === 204 ? null : response.json();
    });
}

function renderTasks() {
    taskList.replaceChildren();
    tasks.forEach((task) => {
        const item = document.createElement("li");
        item.className = `taskItem${task.completed ? " completed" : ""}`;
        item.innerHTML = `
            <label>
                <input type="checkbox" ${task.completed ? "checked" : ""} aria-label="Mark ${escapeHtml(task.title)} as complete">
                <span></span>
            </label>
            <button class="deleteTask" type="button" aria-label="Delete ${escapeHtml(task.title)}">&times;</button>
        `;
        item.querySelector("span").textContent = task.title;
        item.querySelector("input").addEventListener("change", async (event) => {
            try {
                const updatedTask = await authenticatedRequest(`/tasks/${task.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ completed: event.target.checked }),
                });
                task.completed = updatedTask.completed;
                renderTasks();
            } catch (error) {
                event.target.checked = task.completed;
                window.alert(error.message);
            }
        });
        item.querySelector(".deleteTask").addEventListener("click", async () => {
            try {
                await authenticatedRequest(`/tasks/${task.id}`, { method: "DELETE" });
                tasks = tasks.filter((candidate) => candidate.id !== task.id);
                renderTasks();
            } catch (error) {
                window.alert(error.message);
            }
        });
        taskList.appendChild(item);
    });
    emptyState.hidden = tasks.length > 0;
    const completed = tasks.filter((task) => task.completed).length;
    const percent = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
    taskCount.textContent = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
    progressPercent.textContent = `${percent}%`;
    progressSummary.textContent = `${completed} of ${tasks.length} tasks completed`;
    progressMessage.textContent = percent === 100 && tasks.length ? "All done. Great work!" : tasks.length ? "Small steps add up." : "Add a task to get started.";
    progressBar.setAttribute("aria-valuenow", percent);
    progressBar.querySelector("span").style.width = `${percent}%`;
}

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

taskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = taskInput.value.trim();
    if (!title) return;
    try {
        const task = await authenticatedRequest("/tasks", {
            method: "POST",
            body: JSON.stringify({ title }),
        });
        tasks.push(task);
        taskInput.value = "";
        renderTasks();
        taskInput.focus();
    } catch (error) {
        window.alert(error.message);
    }
});

async function loadTasks() {
    try {
        tasks = await authenticatedRequest("/tasks");
        renderTasks();
    } catch (error) {
        progressMessage.textContent = error.message;
        emptyState.textContent = "Log in to load your tasks.";
        emptyState.hidden = false;
    }
}

function toLocalDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function renderCalendar() {
    const today = new Date();
    const year = displayedMonth.getFullYear();
    const month = displayedMonth.getMonth();
    document.getElementById("headerDate").textContent = today.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    document.getElementById("calendarHeading").textContent = displayedMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    calendarGrid.replaceChildren();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPreviousMonth = new Date(year, month, 0).getDate();

    for (let index = 0; index < 42; index += 1) {
        const dayNumber = index - firstDay + 1;
        const dayButton = document.createElement("button");
        dayButton.type = "button";
        dayButton.className = "calendarDay";
        if (dayNumber < 1 || dayNumber > daysInMonth) {
            dayButton.classList.add("isOutside");
            dayButton.textContent = String(dayNumber < 1 ? daysInPreviousMonth + dayNumber : dayNumber - daysInMonth);
            dayButton.disabled = true;
        } else {
            const date = new Date(year, month, dayNumber);
            const dateString = toLocalDateString(date);
            dayButton.textContent = String(dayNumber);
            dayButton.setAttribute("aria-label", date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }));
            if (dateString === toLocalDateString(today)) dayButton.classList.add("isToday");
            const itemCount = calendarTasks.filter((item) => item.date === dateString).length;
            if (itemCount) {
                dayButton.classList.add("hasItems");
                dayButton.dataset.itemCount = String(itemCount);
                dayButton.setAttribute("aria-label", `${dayButton.getAttribute("aria-label")}, ${itemCount} planned ${itemCount === 1 ? "item" : "items"}`);
            }
            dayButton.addEventListener("click", () => openDayPlanner(dateString));
        }
        calendarGrid.appendChild(dayButton);
    }
}

async function loadCalendarMonth() {
    const startDate = toLocalDateString(displayedMonth);
    const endDate = toLocalDateString(new Date(displayedMonth.getFullYear(), displayedMonth.getMonth() + 1, 0));
    try {
        calendarTasks = await authenticatedRequest(`/calendarTasks?start_date=${startDate}&end_date=${endDate}`);
        calendarStatus.textContent = "";
    } catch (error) {
        calendarTasks = [];
        calendarStatus.textContent = error.message;
    }
    renderCalendar();
}

function formatTime(time) {
    if (!time) return "";
    const [hour, minute] = time.split(":").map(Number);
    return new Date(2000, 0, 1, hour, minute).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderDayItems() {
    const items = calendarTasks
        .filter((item) => item.date === selectedDate)
        .sort((left, right) => (left.start_time || "").localeCompare(right.start_time || ""));
    calendarTaskList.replaceChildren();
    document.getElementById("dayItemCount").textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
    document.getElementById("agendaEmpty").hidden = items.length > 0;

    items.forEach((calendarTask) => {
        const item = document.createElement("li");
        item.className = `calendarTaskItem${calendarTask.completed ? " completed" : ""}`;
        const details = document.createElement("div");
        details.className = "calendarTaskDetails";
        const title = document.createElement("strong");
        title.textContent = calendarTask.title;
        const metadata = document.createElement("span");
        const timeRange = [formatTime(calendarTask.start_time), formatTime(calendarTask.end_time)].filter(Boolean).join(" – ");
        const reminder = calendarTask.reminder_at ? `Reminder ${new Date(calendarTask.reminder_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}` : "";
        metadata.textContent = [calendarTask.kind, timeRange, reminder].filter(Boolean).join(" · ");
        details.append(title, metadata);
        if (calendarTask.description) {
            const description = document.createElement("p");
            description.textContent = calendarTask.description;
            details.appendChild(description);
        }
        const actions = document.createElement("div");
        actions.className = "calendarTaskActions";
        if (calendarTask.kind !== "event") {
            const completeButton = document.createElement("button");
            completeButton.type = "button";
            completeButton.className = "taskAction";
            completeButton.textContent = calendarTask.completed ? "Undo" : "Done";
            completeButton.setAttribute("aria-label", `${calendarTask.completed ? "Reopen" : "Complete"} ${calendarTask.title}`);
            completeButton.addEventListener("click", () => updateCalendarTask(calendarTask, !calendarTask.completed));
            actions.appendChild(completeButton);
        }
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "taskAction deleteCalendarTask";
        deleteButton.textContent = "Remove";
        deleteButton.setAttribute("aria-label", `Remove ${calendarTask.title}`);
        deleteButton.addEventListener("click", () => deleteCalendarTask(calendarTask));
        actions.appendChild(deleteButton);
        item.append(details, actions);
        calendarTaskList.appendChild(item);
    });
}

async function openDayPlanner(date) {
    selectedDate = date;
    const dateValue = new Date(`${date}T12:00:00`);
    document.getElementById("dayDialogHeading").textContent = dateValue.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
    });
    calendarTaskForm.reset();
    calendarFormError.textContent = "";
    renderDayItems();
    dayDialog.showModal();
    document.getElementById("calendarTaskTitle").focus();
}

async function updateCalendarTask(calendarTask, completed) {
    try {
        const updated = await authenticatedRequest(`/calendarTasks/${calendarTask.id}`, {
            method: "PATCH",
            body: JSON.stringify({ completed }),
        });
        calendarTasks = calendarTasks.map((item) => item.id === updated.id ? updated : item);
        renderDayItems();
    } catch (error) {
        calendarFormError.textContent = error.message;
    }
}

async function deleteCalendarTask(calendarTask) {
    try {
        await authenticatedRequest(`/calendarTasks/${calendarTask.id}`, { method: "DELETE" });
        calendarTasks = calendarTasks.filter((item) => item.id !== calendarTask.id);
        renderDayItems();
        renderCalendar();
    } catch (error) {
        calendarFormError.textContent = error.message;
    }
}

calendarTaskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    calendarFormError.textContent = "";
    const formData = new FormData(calendarTaskForm);
    const reminderInput = formData.get("reminder_at");
    const payload = {
        title: String(formData.get("title")).trim(),
        kind: formData.get("kind"),
        date: selectedDate,
        start_time: formData.get("start_time") || null,
        end_time: formData.get("end_time") || null,
        reminder_at: reminderInput ? new Date(reminderInput).toISOString() : null,
        description: String(formData.get("description")).trim(),
    };
    const submitButton = document.getElementById("calendarTaskSubmit");
    submitButton.disabled = true;
    try {
        const createdTask = await authenticatedRequest("/calendarTasks", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        calendarTasks.push(createdTask);
        calendarTaskForm.reset();
        renderDayItems();
        renderCalendar();
        document.getElementById("calendarTaskTitle").focus();
    } catch (error) {
        calendarFormError.textContent = error.message;
    } finally {
        submitButton.disabled = false;
    }
});

document.getElementById("closeDayDialog").addEventListener("click", () => dayDialog.close());
dayDialog.addEventListener("click", (event) => {
    if (event.target === dayDialog) dayDialog.close();
});

function appendChatMessage(content, role) {
    const bubble = document.createElement("p");
    bubble.className = `chatBubble ${role === "user" ? "userBubble" : "assistantBubble"}`;
    bubble.textContent = content;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

document.getElementById("chatToggle").addEventListener("click", () => {
    chatPanel.hidden = !chatPanel.hidden;
    document.getElementById("chatToggle").setAttribute("aria-expanded", String(!chatPanel.hidden));
    if (!chatPanel.hidden) chatInput.focus();
});
document.getElementById("closeChat").addEventListener("click", () => {
    chatPanel.hidden = true;
    document.getElementById("chatToggle").setAttribute("aria-expanded", "false");
});

chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = chatInput.value.trim();
    if (!content) return;
    chatHistory.push({ role: "user", content });
    appendChatMessage(content, "user");
    chatInput.value = "";
    document.getElementById("chatStatus").textContent = "Thinking…";
    document.getElementById("chatSubmit").disabled = true;
    try {
        const response = await authenticatedRequest("/chat", {
            method: "POST",
            body: JSON.stringify({
                messages: chatHistory.slice(-20),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                current_date: toLocalDateString(new Date()),
            }),
        });
        if (response.reply) {
            chatHistory.push({ role: "assistant", content: response.reply });
            appendChatMessage(response.reply, "assistant");
        }
        if (response.created_items.length) {
            calendarTasks.push(...response.created_items);
            renderCalendar();
        }
        document.getElementById("chatStatus").textContent = "";
    } catch (error) {
        chatHistory.pop();
        document.getElementById("chatStatus").textContent = error.message;
    } finally {
        document.getElementById("chatSubmit").disabled = false;
        chatInput.focus();
    }
});

document.getElementById("headerDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
loadTasks();
renderCalendar();
loadCalendarMonth();
