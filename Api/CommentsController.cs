using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Presence.Api;

[ApiController]
[Route("api/[controller]")]
public class CommentsController : ControllerBase
{
    private readonly CommentStore _store;

    public CommentsController(CommentStore store)
    {
        _store = store;
    }

    [HttpGet("{mediaId}")]
    [Authorize]
    public ActionResult<List<Comment>> GetComments(string mediaId)
    {
        return Ok(_store.GetComments(mediaId));
    }

    [HttpPost("{mediaId}")]
    [Authorize]
    public ActionResult<Comment> AddComment(string mediaId, [FromBody] AddCommentRequest request)
    {
        var userIdClaim = User.FindFirst("Jellyfin-UserId")?.Value
            ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized();
        }

        var username = User.FindFirst("Jellyfin-Username")?.Value
            ?? User.Identity?.Name
            ?? "Unknown";

        if (string.IsNullOrWhiteSpace(request.Text) || request.Text.Length > 500)
        {
            return BadRequest("Comment must be between 1 and 500 characters.");
        }

        var comment = _store.AddComment(mediaId, userId, username, request.PositionTicks, request.Text);
        return Ok(comment);
    }

    [HttpDelete("{commentId}")]
    [Authorize]
    public ActionResult DeleteComment(string commentId)
    {
        var userIdClaim = User.FindFirst("Jellyfin-UserId")?.Value
            ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return Unauthorized();
        }

        if (_store.DeleteComment(commentId, userId))
        {
            return Ok();
        }

        return NotFound();
    }
}

public class AddCommentRequest
{
    public long PositionTicks { get; set; }
    public string Text { get; set; } = string.Empty;
}
