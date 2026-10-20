cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "1.6.2"
  sha256 arm:   "a362dc2a56e01eed4138be1223049d0edb99ed26ff6944cca35d30789ff1a35c",
         intel: "b171098a4635e116679944ab997112320d873aec294db7cd9b3aaa42df97a787"

  url "https://github.com/johnny4young/lingua/releases/download/v#{version}/Lingua-#{version}-mac-#{arch}.dmg"
  name "Lingua"
  desc "Multi-language code runner for your desktop"
  homepage "https://linguacode.dev/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: :ventura

  app "lingua.app"

  zap trash: [
    "~/Library/Application Support/Lingua",
    "~/Library/Caches/com.lingua.app",
    "~/Library/Logs/Lingua",
    "~/Library/Preferences/com.lingua.app.plist",
    "~/Library/Saved Application State/com.lingua.app.savedState",
  ]
end
