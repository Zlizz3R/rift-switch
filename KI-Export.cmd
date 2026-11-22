@echo off
rem Writes Rift Switch as two text files for AI chats (ChatGPT, Gemini ...) into the folder ki-export
rem and opens that folder. Drag the files into the chat window.
cd /d "%~dp0"
node tools\ai-export.js
if errorlevel 1 (
  pause
  exit /b 1
)
start "" "%~dp0ki-export"
