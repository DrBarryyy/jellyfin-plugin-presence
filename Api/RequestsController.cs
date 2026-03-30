using Jellyfin.Data.Enums;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Providers;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Providers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.Presence.Api;

[ApiController]
[Route("api/[controller]")]
public class RequestsController : ControllerBase
{
    private readonly RequestStore _store;
    private readonly IProviderManager _providerManager;
    private readonly ILibraryManager _libraryManager;
    private readonly string _posterCachePath;
    private static readonly HttpClient _httpClient = new();

    public RequestsController(RequestStore store, IProviderManager providerManager, ILibraryManager libraryManager, IApplicationPaths appPaths)
    {
        _store = store;
        _providerManager = providerManager;
        _libraryManager = libraryManager;
        _posterCachePath = Path.Combine(appPaths.PluginConfigurationsPath, "Presence", "posters");
        Directory.CreateDirectory(_posterCachePath);
    }

    private (Guid userId, string username)? GetUser()
    {
        var userIdClaim = User.FindFirst("Jellyfin-UserId")?.Value
            ?? User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;

        if (string.IsNullOrEmpty(userIdClaim) || !Guid.TryParse(userIdClaim, out var userId))
        {
            return null;
        }

        var username = User.FindFirst("Jellyfin-Username")?.Value
            ?? User.Identity?.Name
            ?? "Unknown";

        return (userId, username);
    }

    [HttpGet]
    [Authorize]
    public ActionResult<List<MediaRequest>> GetAll()
    {
        return Ok(_store.GetAll());
    }

    [HttpPost]
    [Authorize]
    public ActionResult<MediaRequest> Create([FromBody] CreateRequestDto dto)
    {
        var user = GetUser();
        if (user == null) return Unauthorized();

        if (string.IsNullOrWhiteSpace(dto.TmdbId) || string.IsNullOrWhiteSpace(dto.Title))
        {
            return BadRequest("TmdbId and Title are required");
        }

        if (dto.MediaType is not "movie" and not "tv")
        {
            return BadRequest("MediaType must be 'movie' or 'tv'");
        }

        // Check if the item already exists in the library
        var itemType = dto.MediaType == "tv" ? BaseItemKind.Series : BaseItemKind.Movie;
        var libraryItems = _libraryManager.GetItemList(new InternalItemsQuery
        {
            HasAnyProviderId = new Dictionary<string, string> { { "Tmdb", dto.TmdbId } },
            IncludeItemTypes = [itemType],
            Recursive = true
        });

        if (libraryItems.Count > 0)
        {
            return Conflict(new { message = "Already available in library", jellyfinItemId = libraryItems[0].Id.ToString("N") });
        }

        var existing = _store.GetByTmdbId(dto.TmdbId);
        if (existing != null)
        {
            return Conflict(new { message = "This title has already been requested", request = existing });
        }

        var request = _store.Add(
            dto.TmdbId,
            dto.MediaType,
            dto.Title,
            dto.Year,
            dto.PosterPath,
            dto.Overview,
            user.Value.userId,
            user.Value.username
        );

        return Ok(request);
    }

    [HttpPost("CheckLibrary")]
    [Authorize]
    public ActionResult CheckLibrary([FromBody] List<LibraryCheckDto> items)
    {
        var results = new Dictionary<string, string>();
        foreach (var item in items)
        {
            var itemType = item.MediaType == "tv" ? BaseItemKind.Series : BaseItemKind.Movie;
            var libraryItems = _libraryManager.GetItemList(new InternalItemsQuery
            {
                HasAnyProviderId = new Dictionary<string, string> { { "Tmdb", item.TmdbId } },
                IncludeItemTypes = [itemType],
                Recursive = true
            });

            if (libraryItems.Count > 0)
            {
                results[item.TmdbId] = libraryItems[0].Id.ToString("N");
            }
        }

        return Ok(results);
    }

    [HttpDelete("{id}")]
    [Authorize]
    public ActionResult Delete(string id)
    {
        var user = GetUser();
        if (user == null) return Unauthorized();

        var deleted = _store.Delete(id, user.Value.userId);
        if (!deleted)
        {
            return NotFound();
        }

        return Ok();
    }

    [HttpGet("Search")]
    [Authorize]
    public async Task<ActionResult> Search([FromQuery] string query, [FromQuery] string type = "movie", CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return BadRequest("query is required");
        }

        var results = new List<object>();

        if (type == "tv")
        {
            var searchResults = await _providerManager.GetRemoteSearchResults<Series, SeriesInfo>(
                new RemoteSearchQuery<SeriesInfo>
                {
                    SearchInfo = new SeriesInfo { Name = query }
                },
                cancellationToken);

            foreach (var r in searchResults)
            {
                r.ProviderIds.TryGetValue("Tmdb", out var tmdbId);
                if (string.IsNullOrEmpty(tmdbId)) continue;

                results.Add(new
                {
                    tmdbId,
                    title = r.Name,
                    year = r.ProductionYear?.ToString(),
                    posterPath = r.ImageUrl,
                    overview = r.Overview,
                    mediaType = "tv"
                });
            }
        }
        else
        {
            var searchResults = await _providerManager.GetRemoteSearchResults<Movie, MovieInfo>(
                new RemoteSearchQuery<MovieInfo>
                {
                    SearchInfo = new MovieInfo { Name = query }
                },
                cancellationToken);

            foreach (var r in searchResults)
            {
                r.ProviderIds.TryGetValue("Tmdb", out var tmdbId);
                if (string.IsNullOrEmpty(tmdbId)) continue;

                results.Add(new
                {
                    tmdbId,
                    title = r.Name,
                    year = r.ProductionYear?.ToString(),
                    posterPath = r.ImageUrl,
                    overview = r.Overview,
                    mediaType = "movie"
                });
            }
        }

        return Ok(results);
    }

    [HttpGet("Poster")]
    [Authorize]
    public async Task<ActionResult> GetPoster([FromQuery] string url, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(url))
        {
            return BadRequest("url is required");
        }

        // Build the full TMDB URL if it's a relative path
        var fullUrl = url.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? url
            : "https://image.tmdb.org/t/p/w300" + url;

        // Use a safe filename derived from the URL path
        var fileName = Path.GetFileName(new Uri(fullUrl).AbsolutePath);
        if (string.IsNullOrEmpty(fileName))
        {
            return BadRequest("Invalid URL");
        }

        var cachePath = Path.Combine(_posterCachePath, fileName);

        // Serve from cache if available
        if (System.IO.File.Exists(cachePath))
        {
            var cached = await System.IO.File.ReadAllBytesAsync(cachePath, cancellationToken);
            return File(cached, "image/jpeg");
        }

        // Fetch from TMDB and cache
        try
        {
            var response = await _httpClient.GetAsync(fullUrl, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return StatusCode((int)response.StatusCode);
            }

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            await System.IO.File.WriteAllBytesAsync(cachePath, bytes, cancellationToken);

            var contentType = response.Content.Headers.ContentType?.MediaType ?? "image/jpeg";
            return File(bytes, contentType);
        }
        catch (Exception)
        {
            return StatusCode(502);
        }
    }
}

public class CreateRequestDto
{
    public string TmdbId { get; set; } = string.Empty;
    public string MediaType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Year { get; set; }
    public string? PosterPath { get; set; }
    public string? Overview { get; set; }
}

public class LibraryCheckDto
{
    public string TmdbId { get; set; } = string.Empty;
    public string MediaType { get; set; } = string.Empty;
}
