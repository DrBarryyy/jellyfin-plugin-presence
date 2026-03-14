using System;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.Presence;

public class Plugin : BasePlugin<BasePluginConfiguration>
{
    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    public static Plugin? Instance { get; private set; }

    public override string Name => "Presence";

    public override Guid Id => Guid.Parse("d4e5f6a7-b8c9-4d0e-a1b2-c3d4e5f6a7b8");

    public override string Description => "Real-time user presence sidebar showing online, idle, and offline users.";
}
