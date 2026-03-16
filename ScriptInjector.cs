using System.Text.RegularExpressions;
using MediaBrowser.Controller;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.Presence;

public class ScriptInjector : IHostedService
{
    private const string ScriptTag =
        "<script plugin=\"Presence\" src=\"/api/Presence/Script\" defer></script>"
        + "<script plugin=\"Presence\" src=\"/api/Presence/CommentsScript\" defer></script>";

    private readonly IServerApplicationHost _appHost;
    private readonly ILogger<ScriptInjector> _logger;

    public ScriptInjector(IServerApplicationHost appHost, ILogger<ScriptInjector> logger)
    {
        _appHost = appHost;
        _logger = logger;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            var webPath = _appHost.GetType().GetProperty("WebPath")?.GetValue(_appHost) as string;
            if (string.IsNullOrEmpty(webPath))
            {
                // Try common paths
                var candidates = new[]
                {
                    Path.Combine(AppContext.BaseDirectory, "jellyfin-web"),
                    Path.Combine(AppContext.BaseDirectory, "web"),
                    @"C:\Program Files\Jellyfin\Server\jellyfin-web",
                };

                foreach (var candidate in candidates)
                {
                    if (File.Exists(Path.Combine(candidate, "index.html")))
                    {
                        webPath = candidate;
                        break;
                    }
                }
            }

            if (string.IsNullOrEmpty(webPath))
            {
                _logger.LogWarning("[Presence] Could not find jellyfin-web path for script injection");
                return Task.CompletedTask;
            }

            var indexPath = Path.Combine(webPath, "index.html");
            if (!File.Exists(indexPath))
            {
                _logger.LogWarning("[Presence] index.html not found at {Path}", indexPath);
                return Task.CompletedTask;
            }

            var html = File.ReadAllText(indexPath);

            // Remove any old injections
            html = Regex.Replace(html, @"<script plugin=""Presence""[^>]*></script>", string.Empty);

            // Inject before </body>
            if (html.Contains("</body>"))
            {
                html = html.Replace("</body>", ScriptTag + "</body>");
                File.WriteAllText(indexPath, html);
                _logger.LogInformation("[Presence] Scripts injected into index.html");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Presence] Failed to inject scripts into index.html");
        }

        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
