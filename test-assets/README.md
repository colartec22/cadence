# Sample screenshots for testing screenshot reading

These pictures are **made-up schedules** (no real students, teachers or courses taken from anyone's
records). Never add a real student's screenshot here: class schedules are education records (FERPA).

| File | What it tests |
| --- | --- |
| `workday-light.png` | A Workday-style "My Enrolled Courses" table, light theme, with course names, teachers, rooms and an online course mixed in. All 3 class times should be found. |
| `phone-dark.png` | A dark-mode phone screenshot with full day names ("Tuesday/Thursday", "Mon, Wed"). Tests the dark-mode flip and enlarging a narrow picture. |
| `small-blurry.jpg` | A tiny, low-quality JPEG. The browser reader may misread it; the check passes only if any misread line is **marked for fixing** (never silently wrong) and "Try enhanced reading" is offered. |

`expected.json` lists the class times each one should give.

## Running the check

```bash
npm run test:browser
```

It builds the site, serves it with the same security headers as Vercel, opens it in Chrome, and for each
picture uses "Use a screenshot instead" in the Add student form, so the real reader (Tesseract) runs.
It then tries "Try enhanced reading" with a **stand-in** for OCR.space (the real service needs an internet
key), checking that the picture sent is under 1 MB and asks for OCR engine 2 in English. Finally it adds a
student and fills the schedule, to check the main page still works.

Needs Google Chrome installed. If you only have Chromium, point to it:
`CHROMIUM_PATH=/path/to/chromium npm run test:browser`.

To try the **real** OCR.space: deploy to Vercel (or run `vercel dev`) with `OCR_SPACE_API_KEY` and
`MANAGER_PASSCODE` set, open the Add student form, read one of these pictures, sign in, and click
"Try enhanced reading".
