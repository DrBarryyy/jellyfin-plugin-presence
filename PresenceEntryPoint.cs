using System.Threading.Tasks;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Plugins;

namespace Jellyfin.Plugin.Presence;

public class PresenceEntryPoint : IServerEntryPoint
{
    private readonly PresenceManager _manager;

    public PresenceEntryPoint(IUserManager userManager)
    {
        _manager = new PresenceManager(userManager);
    }

    public Task RunAsync()
    {
        _manager.Start();
        return Task.CompletedTask;
    }

    public void Dispose()
    {
        _manager.Dispose();
    }
}
