cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "0.15.0"
  sha256 arm:   "5a29cb82ae3cbdaf77a496686292a3964fa61b88566729e9187e8bcad26b9117",
         intel: "3a50adf6f18b7efc29d9238b68b5515cb33730f1c3553d32dec8a32b2655b333"

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
