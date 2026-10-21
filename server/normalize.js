'use strict';

const clip = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

/** Pull the human-written text out of a raw GitHub event payload. */
function extractText(event) {
  const p = event.payload || {};
  const parts = [p._text];
  switch (event.type) {
    case 'PushEvent':
      // Newer Events API versions dropped `commits`; keep both paths.
      for (const c of p.commits || []) parts.push(c.message);
      if (p.ref) parts.push(p.ref.replace('refs/heads/', ''));
      break;
    case 'CreateEvent':
      parts.push(p.description, p.ref);
      break;
    case 'PullRequestEvent':
      parts.push(p.pull_request?.title, clip(p.pull_request?.body, 1500), p.pull_request?.head?.ref);
      break;
    case 'IssuesEvent':
      parts.push(p.issue?.title, clip(p.issue?.body, 1500));
      break;
    case 'IssueCommentEvent':
      parts.push(p.issue?.title, clip(p.comment?.body, 1500));
      break;
    case 'ReleaseEvent':
      parts.push(p.release?.name, p.release?.tag_name, clip(p.release?.body, 1500));
      break;
    case 'ForkEvent':
      parts.push(p.forkee?.description);
      break;
    case 'PullRequestReviewCommentEvent':
      parts.push(p.pull_request?.title, clip(p.comment?.body, 1000));
      break;
    default:
      break;
  }
  return parts.filter(Boolean).join(' \n ');
}

/** Normalize a raw GitHub event and tag it with detected AI technologies. */
function normalize(event, detector, extra = {}) {
  const repo = event.repo?.name || '';
  const body = extractText(event);
  const text = clip(body, 600);
  const detection = detector.detect(`${repo.replace('/', ' / ')} ${body}`);
  return {
    id: String(event.id),
    type: event.type,
    repo,
    actor: event.actor?.login || '',
    avatar: event.actor?.avatar_url || '',
    createdAt: Date.parse(event.created_at) || Date.now(),
    text,
    ...detection,
    ...extra,
  };
}

/** Convert an imported flat record (event_id, repo_name, …) into a GitHub-like event. */
function fromFlat(rec) {
  return {
    id: rec.event_id,
    type: rec.event_type,
    repo: { name: rec.repo_name },
    actor: { login: rec.actor_login },
    created_at: rec.created_at,
    payload: { _text: rec.text_content },
  };
}

module.exports = { normalize, extractText, fromFlat };
