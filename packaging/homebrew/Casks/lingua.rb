cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "1.5.1"
  sha256 arm:   "0fee713af4fe3f426395a55beb702b422f1a25218c8e26234c65aa2149921506",
         intel: "cba07cd472e0505a9cdce1a83ca2f80a555958b332d0c50e1654ada1a9169187"

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
