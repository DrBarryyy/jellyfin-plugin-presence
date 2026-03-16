using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.Presence;

public class PresenceServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<PresenceManager>();
        serviceCollection.AddHostedService(sp => sp.GetRequiredService<PresenceManager>());
        serviceCollection.AddSingleton<CommentStore>();
        serviceCollection.AddHostedService<ScriptInjector>();
    }
}
