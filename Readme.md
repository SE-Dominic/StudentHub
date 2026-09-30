### How to start program
## Run Backend
# 1. Activate Virtual Environment
- `Windows: .venv\Scripts\Activate.ps1`
- `Mac/ Linux: source .venv/bin/activate`
# 2. Start Fast API
- `cd backend`
- `uvicorn main:app --reload`
- `Should get an "Application startup complete."`

### To start Database
- Run --> `docker compose up -d postgres`

## Calendar and AI planner
- Sign in, then select any day in the calendar to add a task, event, or reminder with optional start/end times and notes.
- Calendar entries are stored per user in PostgreSQL's `calendarTasks` table. Reminder times are saved with the entry and shown in its day agenda.
- To enable the AI study planner, set `OPENAI_API_KEY` in the backend environment before starting FastAPI. Optionally set `OPENAI_MODEL` (defaults to `gpt-4o-mini`).
- The AI planner can answer planning questions and create calendar entries when asked. Its API key stays on the backend; without a key the chat reports that AI is not configured.
- Run the frontend from a local web server and sign in to use calendar storage and chat.

## Class Hub
- Open Class Hub from the top-right of the dashboard. Create a folder using a class name and subject, then create note pages and assign them to an active folder.
- Note pages support a title, sequence label (for example `a.1`, `a.2`, `b.1`), individually placed text boxes, and saved drawings. Select the Text tool and click anywhere on the page to place a text box; there is no free-typing document mode. Text boxes resize from any corner, scaling their text with the box and enforcing a 120 × 54 px minimum size. The drawing toolbar supports pen, line, arrow, rectangle, and ellipse tools with solid, dashed, or dotted strokes and a selectable color.
- Reorder notes using the sequence label. Drag a note card onto a class folder to move it, or change its folder in the page editor. Deleting a folder keeps its pages and moves them to Unfiled.
- The read-only "This week's tasks" list shows calendar tasks and reminders for the current Sunday–Saturday week. Incomplete items appear first; completed items are struck through and moved to the bottom. Events are not included.
- Class folders and note pages are stored per user in the PostgreSQL `classFolders` and `classNotes` tables.