cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "0.14.0"
  sha256 arm:   "34d8d9b43abc43e2edec71b713d3fcafbb29fa1366c58bca0016b65f61f91b23",
         intel: "172df8806cfe8d34a998a27441be0bdd7ba6806b8a990bea88d0a3ecdad58f37"

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

  app "Lingua.app"

  zap trash: [
    "~/Library/Application Support/Lingua",
    "~/Library/Caches/com.lingua.app",
    "~/Library/Logs/Lingua",
    "~/Library/Preferences/com.lingua.app.plist",
    "~/Library/Saved Application State/com.lingua.app.savedState",
  ]
end
