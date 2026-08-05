cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "1.0.0"
  sha256 arm:   "a850e8214f36a4d62486b3ea442c298ce85702e6b0e4fb3b0708ef8fdcf7fe68",
         intel: "3fea46178739f373dcb68d80d679710cfa52e4aa5953e9b11cecf54b14e8aacc"

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
