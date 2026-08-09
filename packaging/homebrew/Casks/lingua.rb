cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "1.0.2"
  sha256 arm:   "c3b41906bb4cadd94d8bb00dd8ccd8bed8df40e220dc0f72f2cfa9e6c206a844",
         intel: "e832dcc311b3d6cc21fabb636a5306d0ab3e535838812e1334c83a43818e7459"

  url "https://github.com/johnny4young/lingua/releases/download/v#{version}/Lingua-#{version}-mac-#{arch}.dmg",
      verified: "github.com/johnny4young/lingua/"
  name "Lingua"
  desc "Multi-language code runner for your desktop"
  homepage "https://linguacode.dev/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: :monterey

  app "lingua.app"

  zap trash: [
    "~/Library/Application Support/Lingua",
    "~/Library/Caches/com.lingua.app",
    "~/Library/Logs/Lingua",
    "~/Library/Preferences/com.lingua.app.plist",
    "~/Library/Saved Application State/com.lingua.app.savedState",
  ]
end
