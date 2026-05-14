# ChatGPT Style Message Bubble Redesign

## Overview

Redesign the message bubble component in `ChatPage.tsx` to follow ChatGPT-style UI:
- User messages right-aligned, AI messages left-aligned
- No bubble borders/backgrounds
- Hover-to-show action buttons
- Proper Chinese text wrapping

## Goals

1. Fix Chinese text breaking mid-character (current bug: "功耗" displayed as 2 lines)
2. Match ChatGPT visual style for familiarity
3. Preserve Markdown + KaTeX rendering for AI responses
4. Keep citation and copy functionality

## Current Problems

- `word-break: break-word` causes Chinese characters to break mid-word
- `overflow-wrap: anywhere` is too aggressive
- `lang="en"` on HTML tag causes CJK line-break algorithm to fail
- Message bubble has excessive styling constraints

## Design

### 1. Layout Structure

```
[User Messages]                    [User Avatar - hidden]
                                   "功耗"

[AI Avatar] [AI Messages]
  A          Summary of the document...
```

- Messages container: full width, no max-width limit
- User messages: `justify-content: flex-end`, right-aligned
- AI messages: `justify-content: flex-start`, left-aligned with avatar

### 2. Avatar Styles

- **AI Avatar**: Circle, 32px diameter
  - Background: `#e5e7eb` (light gray)
  - Text: `#374151` (dark gray), 14px font
  - Shows letter "A"
- **User Avatar**: Not displayed

### 3. Message Content Area

- Container: `max-width: 100%`, no bubble border
- Padding: `16px 0` (top-bottom, left-right)
- Text style:
  - `line-height: 1.6`
  - `color: #343541`
  - `font-size: 16px`

### 4. Text Wrapping Strategy (Critical Fix)

Both user and AI messages:
```css
overflow-wrap: break-word;
word-break: break-word;
```

This ensures:
- Normal text wraps at container edges
- Long URLs/words break at any position when overflow
- Chinese text does NOT break mid-character (fixed by `lang="zh-CN"`)

HTML fix in `index.html`:
```html
<html lang="zh-CN">
```

### 5. Action Buttons

- **Display**: Show on hover, positioned at top-right of message
- **AI message buttons**: Copy + Citation jump
- **User message buttons**: Copy only
- **Button style**: Gray circle icons, darker on hover
- **Transition**: 0.2s ease opacity

### 6. Markdown Rendering (AI Messages Only)

Preserved from current implementation:
- ReactMarkdown + remarkMath + rehypeKatex
- Code block: `background: #f7f7f8`, left border gray
- Inline code: `background: #f0f0f0`, border-radius 4px
- Headings, lists, blockquotes with appropriate spacing

### 7. Message Spacing

- Between messages: `margin-bottom: 24px`
- Inside AI message: paragraphs 16px, lists 12px

## Files to Modify

1. `frontend/src/pages/ChatPage.tsx` - MessageBubble component (lines 253-702)
2. `frontend/index.html` - Change `lang="en"` to `lang="zh-CN"` (already done)

## Out of Scope

- User avatar display (keeping hidden for now)
- Message editing/resending
- Streaming message animation
- File attachment display in messages

## Success Criteria

1. Chinese text "功耗" displays on single line in user bubble
2. Long text wraps at container edge, not mid-character
3. AI messages have left-aligned avatar with "A" letter
4. Hover reveals copy/citation buttons
5. Markdown rendering preserved
6. No visual regressions in citation panel or PDF viewer
