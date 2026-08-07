package vuln

// unfinished rename left both names live
func oldProcess(x int) int {
	return x + 1
}

func newProcess(x int) int {
	return oldProcess(x)
}
