# ChatGPT Style Message Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the message bubble to ChatGPT style — full-width messages, no bubble borders, right-aligned user / left-aligned AI, hover action buttons, fix Chinese text wrapping.

**Architecture:** Refactor `MessageBubble` component in-place in `ChatPage.tsx`. Remove bubble styling, restructure layout with avatar on the left for AI messages, and move action buttons to a hover overlay. The `lang="zh-CN"` fix in `index.html` is already applied.

**Tech Stack:** React, inline styles, ReactMarkdown, KaTeX

---

### Task 1: Restructure MessageBubble layout — outer container and avatar

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx:261-702` (MessageBubble component)

- [ ] **Step 1: Rewrite the outer flex container and avatar section**

Replace the entire `return (...)` block of `MessageBubble` (lines 273-701) with the new ChatGPT-style layout. First, replace just the outer container and avatar:

```tsx
const [hovered, setHovered] = useState(false)

return (
  <div
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
    style={{
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      alignItems: 'flex-start',
      gap: 0,
      position: 'relative',
      width: '100%',
    }}
  >
    {/* Avatar - only for AI messages */}
    {!isUser && (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: '#e5e7eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          fontSize: 14,
          color: '#374151',
          fontWeight: 600,
          marginRight: 16,
          marginTop: 2,
        }}
      >
        A
      </div>
    )}

    {/* Selection checkbox - only shown on hover */}
    {onToggleSelect && (
      <div
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelect()
        }}
        style={{
          width: 20,
          height: 20,
          borderRadius: 4,
          border: isSelected ? 'none' : '1px solid #d1d5db',
          background: isSelected ? '#6366f1' : '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: 'pointer',
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.2s',
          marginRight: isUser ? 0 : 8,
          marginLeft: isUser ? 8 : 0,
          marginTop: 6,
        }}
      >
        {isSelected && (
          <CheckOutlined style={{ fontSize: 12, color: '#fff' }} />
        )}
      </div>
    )}

    {/* Content wrapper */}
    <div
      style={{
        flex: 1,
        minWidth: 0,
        maxWidth: '100%',
        position: 'relative',
      }}
    >
```

- [ ] **Step 2: Verify layout compiles**

Run: `cd /Users/neo/PycharmProjects/PageIndex/frontend && npx tsc --noEmit 2>&1 | head -20`

Expected: No TypeScript errors related to MessageBubble (other unrelated errors may exist).

---

### Task 2: Rewrite message content area — remove bubble styling

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx` (inside MessageBubble return)

- [ ] **Step 1: Replace the message bubble div and its inner content**

Replace the old `{/* Message bubble */}` div (the one with `background`, `borderRadius`, etc.) and the `{/* Message actions bar */}` section that follows it, keeping the `</div>` closers intact. The new code goes inside the "Content wrapper" div from Task 1:

```tsx
      {/* Message content - no bubble background */}
      <div
        style={{
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
        }}
      >
        {/* Render markdown for assistant, plain text for user */}
        {isUser ? (
          <div style={{ color: '#343541', lineHeight: 1.6, whiteSpace: 'pre-wrap', fontSize: 16 }}>
            {msg.content}
          </div>
        ) : (
          <div className="markdown-body" style={{ color: '#343541', lineHeight: 1.7 }}>
            {/* ... existing ReactMarkdown with all components stays exactly the same ... */}
          </div>
        )}
      </div>

      {/* Action buttons - show on hover */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          marginTop: 4,
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.2s',
          pointerEvents: hovered ? 'auto' : 'none',
        }}
      >
        <Tooltip title={copied ? 'Copied!' : 'Copy'}>
          <button
            onClick={handleCopy}
            style={{
              padding: '4px 8px',
              border: 'none',
              borderRadius: 6,
              background: 'transparent',
              color: copied ? '#10b981' : '#6b7280',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f3f4f6'
              e.currentTarget.style.color = copied ? '#10b981' : '#374151'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = copied ? '#10b981' : '#6b7280'
            }}
          >
            {copied ? <CheckOutlined style={{ fontSize: 14 }} /> : <CopyOutlined style={{ fontSize: 14 }} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </Tooltip>
      </div>
    </div>
  </div>
)
```

- [ ] **Step 2: Verify the component compiles**

Run: `cd /Users/neo/PycharmProjects/PageIndex/frontend && npx tsc --noEmit 2>&1 | head -20`

Expected: No TypeScript errors related to MessageBubble.

---

### Task 3: Update message list container — remove maxWidth constraint

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx:1320-1341`

- [ ] **Step 1: Remove the maxWidth: 900 constraint on the messages wrapper**

Find the `<div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 32px' }}>` that wraps `messages.map(...)` and remove the `maxWidth: 900` and `margin: '0 auto'`:

Change from:
```tsx
<div
  style={{
    maxWidth: 900,
    margin: '0 auto',
    padding: '24px 32px',
  }}
>
```

To:
```tsx
<div
  style={{
    padding: '24px 32px',
    maxWidth: '100%',
  }}
>
```

- [ ] **Step 2: Remove per-message alignment wrappers**

Find the wrapper div around `<MessageBubble>` (lines 1328-1340) that has `justifyContent` and `marginLeft`/`marginRight` logic. Simplify it — the MessageBubble itself now handles alignment:

Change from:
```tsx
{messages.map((msg) => (
  <div
    key={msg.id}
    style={{
      marginBottom: 24,
      animation: 'fadeIn 0.3s ease-out',
      display: 'flex',
      justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
      marginLeft: msg.role === 'user' ? 'auto' : 0,
      marginRight: msg.role === 'user' ? 0 : 'auto',
    }}
  >
    <MessageBubble msg={msg} onCitationClick={handleCitationClick} isSelected={selectedMessages.has(msg.id)} onToggleSelect={() => toggleMessageSelection(msg.id)} />
  </div>
))}
```

To:
```tsx
{messages.map((msg) => (
  <div
    key={msg.id}
    style={{
      marginBottom: 24,
      animation: 'fadeIn 0.3s ease-out',
    }}
  >
    <MessageBubble msg={msg} onCitationClick={handleCitationClick} isSelected={selectedMessages.has(msg.id)} onToggleSelect={() => toggleMessageSelection(msg.id)} />
  </div>
))}
```

- [ ] **Step 3: Verify and test in browser**

Run: `cd /Users/neo/PycharmProjects/PageIndex/frontend && npx tsc --noEmit 2>&1 | head -20`

Expected: No TypeScript errors.

Start dev server and verify:
1. User messages appear right-aligned, no bubble background
2. AI messages appear left-aligned with gray circle avatar "A"
3. "功耗" displays on a single line
4. Long text wraps at container edge
5. Hover shows copy button
6. Markdown rendering preserved in AI messages
7. Citations still clickable

---

### Task 4: Commit

- [ ] **Step 1: Stage and commit all changes**

```bash
cd /Users/neo/PycharmProjects/PageIndex
git add frontend/src/pages/ChatPage.tsx
git commit -m "style: refactor message bubble to ChatGPT-style layout

- Remove bubble borders/backgrounds, use full-width messages
- User messages right-aligned, AI messages left-aligned with avatar
- Avatar: gray circle with 'A' letter for AI, hidden for user
- Action buttons (copy) show on hover with opacity transition
- Fix Chinese text wrapping with overflow-wrap: break-word
- Remove maxWidth: 900 constraint on message list"
```
