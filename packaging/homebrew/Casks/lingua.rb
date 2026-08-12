cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "1.2.0"
  sha256 arm:   "bca8954edc26deea79d0929700ec42e4d6ee82d2ac85cc235bac8677c03c8795",
         intel: "e99b319ffa02192688d065d295985c40b2628c41b555b33c3d0585431351d65a"

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
