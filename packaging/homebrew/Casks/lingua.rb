cask "lingua" do
  arch arm: "arm64", intel: "x64"

  version "1.4.1"
  sha256 arm:   "b1cb5d058f77e7a306141f2f911b3807ddd6ee1e9a1661e82ed830818836bf85",
         intel: "d09d5d2b3c407cbfcef6b2fa95c46b3c1d050155d7408f52c92408ff01f95da4"

  url "https://github.com/johnny4young/lingua/releases/download/v#{version}/Lingua-#{version}-mac-#{arch}.dmg"
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
