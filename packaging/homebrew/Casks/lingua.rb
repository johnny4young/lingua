cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "2.1.0"
  sha256 arm:   "79ad633b799318a8569b13a87fd31737a7e6c7dc287b6b9d39f05aa524779e4b",
         intel: "664f9d8c1e02c92610535612b05ec08b7beded71b87689dbbf63f774b35d22d7"

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
