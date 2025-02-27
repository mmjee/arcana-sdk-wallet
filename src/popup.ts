class Popup {
  private window: Window | null
  constructor(public url: string) {}

  public open() {
    const windowFeatures = getWindowFeatures()
    this.window = window.open(this.url, '_blank', windowFeatures)
    return this.getWindowResponse()
  }

  private getWindowResponse() {
    return new Promise((resolve, reject) => {
      let cleanExit = false
      const id = window.setInterval(() => {
        if (!cleanExit && this.window?.closed) {
          reject('User closed the popup')
        }
      }, 500)
      const handler = async (event: MessageEvent) => {
        if (!event?.data?.status) {
          return
        }
        const data = event.data as MessageData
        cleanExit = true
        this.clear(handler, id)

        if (data.status === 'success') {
          this.window?.close()
          return resolve('success')
        } else if (data.status == 'error') {
          this.window?.close()
          return reject(data.error)
        } else if (data.status === 'done') {
          return resolve('done')
        } else {
          console.log('Unexpected event')
        }
      }
      window.addEventListener('message', handler, false)
    })
  }

  private clear(handler: (ev: MessageEvent) => void, id: number): void {
    window.removeEventListener('message', handler)
    window.clearInterval(id)
  }
}

// success for when login is complete - social
// done is for when popup work is over but shouldn't be closed - link
interface MessageData {
  status: 'success' | 'error' | 'done'
  error?: string
}

const popupFeatures: { [key: string]: number } = {
  titlebar: 0,
  toolbar: 0,
  status: 0,
  menubar: 0,
  resizable: 0,
  height: 1200,
  width: 700,
  popup: 1,
}

const getWindowFeatures = (): string => {
  const f: string[] = []
  for (const feature in popupFeatures) {
    f.push(`${feature}=${popupFeatures[feature]}`)
  }
  return f.join(',')
}

export default Popup
