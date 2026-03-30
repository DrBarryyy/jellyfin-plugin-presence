using Jellyfin.Data.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Presence;

public class RequestManager : IHostedService, IDisposable
{
    private readonly ILibraryManager _libraryManager;
    private readonly RequestStore _requestStore;
    private readonly ILogger<RequestManager> _logger;

    public RequestManager(ILibraryManager libraryManager, RequestStore requestStore, ILogger<RequestManager> logger)
    {
        _libraryManager = libraryManager;
        _requestStore = requestStore;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _libraryManager.ItemAdded += OnItemAdded;

        // Scan all pending requests against existing library on startup
        Task.Run(() => ScanAll(), cancellationToken);

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _libraryManager.ItemAdded -= OnItemAdded;
        return Task.CompletedTask;
    }

    private void OnItemAdded(object? sender, ItemChangeEventArgs e)
    {
        try
        {
            CheckItem(e.Item);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Presence] Error checking added item {Name}", e.Item.Name);
        }
    }

    private void CheckItem(BaseItem item)
    {
        if (item is not Movie and not Series)
        {
            return;
        }

        if (!item.ProviderIds.TryGetValue(MetadataProvider.Tmdb.ToString(), out var tmdbId) || string.IsNullOrEmpty(tmdbId))
        {
            return;
        }

        if (_requestStore.MarkAvailable(tmdbId, item.Id.ToString("N")))
        {
            _logger.LogInformation("[Presence] Request fulfilled: {Name} (TMDB {TmdbId})", item.Name, tmdbId);
        }
    }

    private void ScanAll()
    {
        try
        {
            var pending = _requestStore.GetPending();
            if (pending.Count == 0) return;

            _logger.LogInformation("[Presence] Scanning library for {Count} pending request(s)", pending.Count);

            var pendingByTmdb = new Dictionary<string, MediaRequest>();
            foreach (var req in pending)
            {
                pendingByTmdb[req.TmdbId] = req;
            }

            var allItems = _libraryManager.GetItemList(new InternalItemsQuery
            {
                IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Series],
                Recursive = true
            });

            foreach (var item in allItems)
            {
                if (item.ProviderIds.TryGetValue(MetadataProvider.Tmdb.ToString(), out var tmdbId)
                    && !string.IsNullOrEmpty(tmdbId)
                    && pendingByTmdb.ContainsKey(tmdbId))
                {
                    if (_requestStore.MarkAvailable(tmdbId, item.Id.ToString("N")))
                    {
                        _logger.LogInformation("[Presence] Startup scan: fulfilled request for {Name} (TMDB {TmdbId})", item.Name, tmdbId);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Presence] Error during startup library scan");
        }
    }

    public void Dispose()
    {
    }
}
