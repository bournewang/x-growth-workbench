/* Filter already-loaded TweetDetail author models without new requests. */
(function (root) {
  'use strict';
  function matches(comment, { onlyUnfollowed = true, onlyBlue = false, viewerId = '', viewerHandle = '' } = {}) {
    const author = comment?.author;
    if (onlyUnfollowed && (
      (viewerId && author?.id === viewerId) ||
      (viewerHandle && author?.handle?.toLowerCase() === viewerHandle.toLowerCase())
    )) return false;
    if (onlyUnfollowed && (author?.following !== false || author?.followRequestSent === true)) return false;
    if (onlyBlue && author?.blueVerified !== true) return false;
    return true;
  }
  const api = Object.freeze({ matches });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.XPCCommentFilter = api;
})(globalThis);
